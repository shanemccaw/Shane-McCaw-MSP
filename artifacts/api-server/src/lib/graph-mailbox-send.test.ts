/**
 * sendMailViaGraphForMsp — Git #4241.
 *
 * Exercises the send itself (not only the pure rule in mailbox-send-app.test.ts):
 * it must authenticate as the dedicated mailbox-send app, never the shared read
 * app, and must refuse before sending unless the connector's tenant, the MSP's
 * recorded own tenant (msps.entra_tenant_id, #4242) and the issued token's `tid`
 * all agree.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.MT_APP_CLIENT_ID = "read-app-client-id";
process.env.MT_APP_CLIENT_SECRET = "read-app-secret";
process.env.JWT_SECRET = "test-jwt-secret";

// db.select({...}).from(mspsTable).where(...).limit(1) — the MSP's own tenant read.
const limitMock = vi.fn();
const whereMock = vi.fn(() => ({ limit: limitMock }));
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));
const updateMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { select: (_arg?: unknown) => selectMock(), update: (...a: unknown[]) => updateMock(...a) },
  tenantsTable: { mspId: "msp_id", tenantId: "tenant_id", consent: "consent" },
  mspsTable: { id: "id", entraTenantId: "entra_tenant_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  sql: vi.fn(),
}));

vi.mock("./logger.ts", () => {
  const child = vi.fn();
  const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child };
  child.mockReturnValue(base);
  return { logger: base };
});

import { sendMailViaGraphForMsp, ConsentRevokedError } from "./graph.ts";
import { MailboxSendTenantRefusedError, evictMailboxSendToken } from "./mailbox-send-app.ts";

const OWN = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const CUSTOMER = "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function tokenFor(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}
const tokenResponse = (tid: string) =>
  new Response(JSON.stringify({ access_token: tokenFor({ tid, roles: ["Mail.Send"] }), expires_in: 3600 }), { status: 200 });

const baseOpts = {
  mspId: 7,
  mspTenantId: OWN,
  fromMailboxUpn: "support@mccawsoft2.onmicrosoft.com",
  fromDisplayName: "Support",
  to: "someone@example.com",
  subject: "Hello",
  htmlBody: "<p>Hi</p>",
};

beforeEach(() => {
  fetchMock.mockReset();
  limitMock.mockReset();
  updateMock.mockReset();
  evictMailboxSendToken(OWN);
  process.env.MAILBOX_SEND_APP_CLIENT_ID = "mailbox-send-app-client-id";
  process.env.MAILBOX_SEND_APP_CLIENT_SECRET = "mailbox-send-secret";
});

describe("sendMailViaGraphForMsp (#4241)", () => {
  it("refuses outright when the dedicated app is not configured, even though the read app is", async () => {
    delete process.env.MAILBOX_SEND_APP_CLIENT_ID;
    await expect(sendMailViaGraphForMsp(baseOpts)).rejects.toThrow(/Mailbox send app not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses before requesting any token when the MSP has not recorded its own tenant", async () => {
    limitMock.mockResolvedValueOnce([{ entraTenantId: null }]);
    const err = await sendMailViaGraphForMsp(baseOpts).catch((e) => e);
    expect(err).toBeInstanceOf(MailboxSendTenantRefusedError);
    expect(err.reason).toBe("own_tenant_unset");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses before requesting any token when the connector is bound to a customer tenant", async () => {
    limitMock.mockResolvedValueOnce([{ entraTenantId: OWN }]);
    const err = await sendMailViaGraphForMsp({ ...baseOpts, mspTenantId: CUSTOMER }).catch((e) => e);
    expect(err).toBeInstanceOf(MailboxSendTenantRefusedError);
    expect(err.reason).toBe("connector_not_own_tenant");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without sending when Microsoft issues the token for a different tenant", async () => {
    limitMock.mockResolvedValueOnce([{ entraTenantId: OWN }]);
    fetchMock.mockResolvedValueOnce(tokenResponse(CUSTOMER));
    const err = await sendMailViaGraphForMsp(baseOpts).catch((e) => e);
    expect(err).toBeInstanceOf(MailboxSendTenantRefusedError);
    expect(err.reason).toBe("token_not_own_tenant");
    expect(fetchMock).toHaveBeenCalledTimes(1); // token only — no sendMail
  });

  it("sends with the dedicated app's token against the MSP's own tenant", async () => {
    limitMock.mockResolvedValueOnce([{ entraTenantId: OWN }]);
    fetchMock.mockResolvedValueOnce(tokenResponse(OWN)).mockResolvedValueOnce(new Response(null, { status: 202 }));

    await sendMailViaGraphForMsp(baseOpts);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(tokenUrl).toBe(`https://login.microsoftonline.com/${OWN}/oauth2/v2.0/token`);
    expect(new URLSearchParams(tokenInit.body).get("client_id")).toBe("mailbox-send-app-client-id");

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, { headers: Record<string, string> }];
    expect(sendUrl).toBe(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(baseOpts.fromMailboxUpn)}/sendMail`);
    expect(sendInit.headers.Authorization).toBe(`Bearer ${tokenFor({ tid: OWN, roles: ["Mail.Send"] })}`);
  });

  it("maps a consent-signature token failure to ConsentRevokedError without touching any tenant row", async () => {
    limitMock.mockResolvedValueOnce([{ entraTenantId: OWN }]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "AADSTS65001: consent not granted" }), { status: 400 }),
    );
    await expect(sendMailViaGraphForMsp(baseOpts)).rejects.toBeInstanceOf(ConsentRevokedError);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
