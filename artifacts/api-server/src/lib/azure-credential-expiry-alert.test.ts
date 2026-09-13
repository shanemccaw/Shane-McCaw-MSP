/**
 * Unit tests for the Git #3861 Azure Tenant Credential expiry-alert sweep.
 *
 * Covers:
 *  1. No admin recipient configured → no sends, reported honestly.
 *  2. An expiring, never-alerted credential → email sent, last_expiry_alert_sent_at stamped.
 *  3. A credential alerted within the resend window → skipped, not re-sent.
 *  4. A client-linked credential → email built with the resolved client name/email.
 *  5. A failed send is not marked alerted (so it retries on the next sweep).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  azureTenantCredentialsTable: { id: "id", displayName: "display_name" },
  usersTable: { id: "id" },
}));

vi.mock("./azure-keyvault.ts", () => ({
  getSecretMetadata: vi.fn(),
}));

vi.mock("./mailer.ts", () => ({
  azureCredentialExpiryAlertEmail: vi.fn(() => "<html>alert</html>"),
  sendEmailOrThrow: vi.fn().mockResolvedValue(undefined),
}));

function makeLoggerMock(): { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; child: ReturnType<typeof vi.fn> } {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLoggerMock()),
  };
}
vi.mock("./logger.ts", () => ({ logger: makeLoggerMock() }));

// ── Import after mocks ────────────────────────────────────────────────────────

import { handleAzureCredentialExpiryAlert } from "./azure-credential-expiry-alert.ts";
import { db } from "@workspace/db";
import { getSecretMetadata } from "./azure-keyvault.ts";
import { azureCredentialExpiryAlertEmail, sendEmailOrThrow } from "./mailer.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

function makeOrderByChain(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(rows) } as AnyMock;
}
function makeWhereChain(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) } as AnyMock;
}
function makeUpdateChain() {
  return { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) } as AnyMock;
}

const NOW = new Date("2026-09-12T12:00:00Z");
const IN_10_DAYS = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000);

describe("handleAzureCredentialExpiryAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    delete process.env.ADMIN_EMAIL;
    delete process.env.CRM_ADMIN_EMAIL;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ADMIN_EMAIL;
    delete process.env.CRM_ADMIN_EMAIL;
  });

  it("sends nothing and reports skippedNoRecipientCount when no admin email is configured", async () => {
    vi.mocked(db.select).mockReturnValue(makeOrderByChain([
      { id: 1, displayName: "Contoso App Reg", clientUserId: null, tenantId: "tenant-1", clientId: "client-1", keyVaultSecretName: "secret-1", lastExpiryAlertSentAt: null },
    ]));
    vi.mocked(getSecretMetadata).mockResolvedValue({ expiresOn: IN_10_DAYS, enabled: true });

    const result = await handleAzureCredentialExpiryAlert({});

    expect(result.expiringCount).toBe(1);
    expect(result.alertedCount).toBe(0);
    expect(result.skippedNoRecipientCount).toBe(1);
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });

  it("sends an alert and stamps last_expiry_alert_sent_at for a never-alerted expiring credential", async () => {
    process.env.ADMIN_EMAIL = "shane@example.com";
    vi.mocked(db.select).mockReturnValue(makeOrderByChain([
      { id: 1, displayName: "Contoso App Reg", clientUserId: null, tenantId: "tenant-1", clientId: "client-1", keyVaultSecretName: "secret-1", lastExpiryAlertSentAt: null },
    ]));
    vi.mocked(getSecretMetadata).mockResolvedValue({ expiresOn: IN_10_DAYS, enabled: true });
    const updateChain = makeUpdateChain();
    vi.mocked(db.update).mockReturnValue(updateChain);

    const result = await handleAzureCredentialExpiryAlert({});

    expect(result.alertedCount).toBe(1);
    expect(sendEmailOrThrow).toHaveBeenCalledTimes(1);
    expect(sendEmailOrThrow).toHaveBeenCalledWith(
      "shane@example.com",
      expect.stringContaining("Contoso App Reg"),
      "<html>alert</html>",
      expect.objectContaining({ templateName: "azure-credential-expiry-alert" }),
    );
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith({ lastExpiryAlertSentAt: NOW });
  });

  it("skips a credential alerted within the last 24h", async () => {
    process.env.ADMIN_EMAIL = "shane@example.com";
    const alertedTwoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    vi.mocked(db.select).mockReturnValue(makeOrderByChain([
      { id: 1, displayName: "Contoso App Reg", clientUserId: null, tenantId: "tenant-1", clientId: "client-1", keyVaultSecretName: "secret-1", lastExpiryAlertSentAt: alertedTwoHoursAgo },
    ]));
    vi.mocked(getSecretMetadata).mockResolvedValue({ expiresOn: IN_10_DAYS, enabled: true });

    const result = await handleAzureCredentialExpiryAlert({});

    expect(result.expiringCount).toBe(1);
    expect(result.alertedCount).toBe(0);
    expect(result.skippedRecentlyAlertedCount).toBe(1);
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("resolves the linked client's name/email and passes them to the template", async () => {
    process.env.ADMIN_EMAIL = "shane@example.com";
    vi.mocked(db.select)
      .mockReturnValueOnce(makeOrderByChain([
        { id: 1, displayName: "Client Tenant App Reg", clientUserId: 42, tenantId: "tenant-1", clientId: "client-1", keyVaultSecretName: "secret-1", lastExpiryAlertSentAt: null },
      ]))
      .mockReturnValueOnce(makeWhereChain([{ id: 42, name: "Acme Corp", email: "it@acme.example" }]));
    vi.mocked(getSecretMetadata).mockResolvedValue({ expiresOn: IN_10_DAYS, enabled: true });
    vi.mocked(db.update).mockReturnValue(makeUpdateChain());

    await handleAzureCredentialExpiryAlert({});

    expect(azureCredentialExpiryAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "Acme Corp", clientEmail: "it@acme.example" }),
    );
  });

  it("does not mark a credential alerted when the send fails (so it retries next sweep)", async () => {
    process.env.ADMIN_EMAIL = "shane@example.com";
    vi.mocked(db.select).mockReturnValue(makeOrderByChain([
      { id: 1, displayName: "Contoso App Reg", clientUserId: null, tenantId: "tenant-1", clientId: "client-1", keyVaultSecretName: "secret-1", lastExpiryAlertSentAt: null },
    ]));
    vi.mocked(getSecretMetadata).mockResolvedValue({ expiresOn: IN_10_DAYS, enabled: true });
    vi.mocked(sendEmailOrThrow).mockRejectedValueOnce(new Error("Graph throttled"));

    const result = await handleAzureCredentialExpiryAlert({});

    expect(result.alertedCount).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("excludes credentials outside the expiry warn window entirely", async () => {
    process.env.ADMIN_EMAIL = "shane@example.com";
    const in200Days = new Date(NOW.getTime() + 200 * 24 * 60 * 60 * 1000);
    vi.mocked(db.select).mockReturnValue(makeOrderByChain([
      { id: 1, displayName: "Far Future App Reg", clientUserId: null, tenantId: "tenant-1", clientId: "client-1", keyVaultSecretName: "secret-1", lastExpiryAlertSentAt: null },
    ]));
    vi.mocked(getSecretMetadata).mockResolvedValue({ expiresOn: in200Days, enabled: true });

    const result = await handleAzureCredentialExpiryAlert({});

    expect(result.expiringCount).toBe(0);
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });
});
