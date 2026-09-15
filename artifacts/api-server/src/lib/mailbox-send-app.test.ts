/**
 * mailbox-send-app (Git #4241) — the dedicated mailbox-send App Registration:
 * credential selection, the certificate client assertion, the own-tenant rule,
 * and the token request. No real credential material: the key is generated per run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

vi.mock("./logger.ts", () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = vi.fn(() => logger);
  return { logger };
});

import {
  checkMailboxSendTenant,
  evictMailboxSendToken,
  getMailboxSendAccessToken,
  mailboxSendAppAuthMode,
  mailboxSendAppClientAuthParams,
  tokenTenantId,
} from "./mailbox-send-app.ts";

const OWN = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const CUSTOMER = "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const THUMBPRINT = "0123456789abcdef0123456789abcdef01234567";

function tokenFor(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

const ENV_KEYS = [
  "MAILBOX_SEND_APP_CLIENT_ID",
  "MAILBOX_SEND_APP_CLIENT_SECRET",
  "MAILBOX_SEND_APP_CERT_PRIVATE_KEY",
  "MAILBOX_SEND_APP_CERT_THUMBPRINT",
];
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("mailboxSendAppAuthMode", () => {
  it("is null without a client id, or with a client id and no credential", () => {
    expect(mailboxSendAppAuthMode({ MAILBOX_SEND_APP_CLIENT_SECRET: "s" })).toBeNull();
    expect(mailboxSendAppAuthMode({ MAILBOX_SEND_APP_CLIENT_ID: "app" })).toBeNull();
    // a cert key without its thumbprint is not a usable certificate credential
    expect(mailboxSendAppAuthMode({ MAILBOX_SEND_APP_CLIENT_ID: "app", MAILBOX_SEND_APP_CERT_PRIVATE_KEY: "k" })).toBeNull();
  });

  it("never falls back to the shared read app's credentials", () => {
    expect(mailboxSendAppAuthMode({ MT_APP_CLIENT_ID: "read-app", MT_APP_CLIENT_SECRET: "read-secret" })).toBeNull();
  });

  it("prefers a certificate over a secret when both are set", () => {
    const env = {
      MAILBOX_SEND_APP_CLIENT_ID: "app",
      MAILBOX_SEND_APP_CLIENT_SECRET: "s",
      MAILBOX_SEND_APP_CERT_PRIVATE_KEY: "k",
      MAILBOX_SEND_APP_CERT_THUMBPRINT: "t",
    };
    expect(mailboxSendAppAuthMode(env)).toBe("certificate");
    expect(mailboxSendAppAuthMode({ MAILBOX_SEND_APP_CLIENT_ID: "app", MAILBOX_SEND_APP_CLIENT_SECRET: "s" })).toBe("secret");
  });
});

describe("mailboxSendAppClientAuthParams", () => {
  it("uses the client secret in secret mode", () => {
    expect(
      mailboxSendAppClientAuthParams(OWN, { MAILBOX_SEND_APP_CLIENT_ID: "app", MAILBOX_SEND_APP_CLIENT_SECRET: "s3cret" }),
    ).toEqual({ client_id: "app", client_secret: "s3cret" });
  });

  it("signs an RS256 client assertion for the tenant's token endpoint in certificate mode (#4156 base64 key)", () => {
    const params = mailboxSendAppClientAuthParams(OWN, {
      MAILBOX_SEND_APP_CLIENT_ID: "app",
      MAILBOX_SEND_APP_CERT_PRIVATE_KEY: Buffer.from(pem).toString("base64"),
      MAILBOX_SEND_APP_CERT_THUMBPRINT: THUMBPRINT,
    });
    expect(params.client_secret).toBeUndefined();
    expect(params.client_assertion_type).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    const verified = jwt.verify(params.client_assertion, publicKey.export({ type: "spki", format: "pem" }).toString(), {
      algorithms: ["RS256"],
      complete: true,
    });
    const payload = verified.payload as jwt.JwtPayload;
    expect(payload.iss).toBe("app");
    expect(payload.sub).toBe("app");
    expect(payload.aud).toBe(`https://login.microsoftonline.com/${OWN}/oauth2/v2.0/token`);
    expect(verified.header.x5t).toBe(Buffer.from(THUMBPRINT, "hex").toString("base64url"));
  });

  it("throws naming the env var, not the value, when the certificate key is unusable or nothing is configured", () => {
    const bogus = Buffer.from("-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----").toString("base64");
    expect(() =>
      mailboxSendAppClientAuthParams(OWN, {
        MAILBOX_SEND_APP_CLIENT_ID: "app",
        MAILBOX_SEND_APP_CERT_PRIVATE_KEY: bogus,
        MAILBOX_SEND_APP_CERT_THUMBPRINT: THUMBPRINT,
      }),
    ).toThrow(/MAILBOX_SEND_APP_CERT_PRIVATE_KEY/);
    expect(() => mailboxSendAppClientAuthParams(OWN, {})).toThrow(/Mailbox send app not configured/);
  });
});

describe("checkMailboxSendTenant", () => {
  it("refuses when the MSP has not recorded its own tenant", () => {
    expect(checkMailboxSendTenant({ mspEntraTenantId: null, connectorTenantId: OWN })).toEqual({ ok: false, reason: "own_tenant_unset" });
    expect(checkMailboxSendTenant({ mspEntraTenantId: "  ", connectorTenantId: OWN })).toEqual({ ok: false, reason: "own_tenant_unset" });
  });

  it("refuses a connector bound to any other tenant, e.g. one of the MSP's customers", () => {
    expect(checkMailboxSendTenant({ mspEntraTenantId: OWN, connectorTenantId: CUSTOMER })).toEqual({ ok: false, reason: "connector_not_own_tenant" });
  });

  it("refuses a token Microsoft issued for another tenant, or one with no tid", () => {
    expect(checkMailboxSendTenant({ mspEntraTenantId: OWN, connectorTenantId: OWN, tokenTenantId: CUSTOMER })).toEqual({ ok: false, reason: "token_not_own_tenant" });
    expect(checkMailboxSendTenant({ mspEntraTenantId: OWN, connectorTenantId: OWN, tokenTenantId: null })).toEqual({ ok: false, reason: "token_not_own_tenant" });
  });

  it("allows the own tenant, case-insensitively", () => {
    expect(checkMailboxSendTenant({ mspEntraTenantId: OWN.toUpperCase(), connectorTenantId: OWN, tokenTenantId: OWN })).toEqual({ ok: true, ownTenantId: OWN });
  });
});

describe("tokenTenantId", () => {
  it("reads and lowercases tid, null for garbage", () => {
    expect(tokenTenantId(tokenFor({ tid: OWN.toUpperCase() }))).toBe(OWN);
    expect(tokenTenantId("not-a-jwt")).toBeNull();
    expect(tokenTenantId(tokenFor({ roles: ["Mail.Send"] }))).toBeNull();
  });
});

describe("getMailboxSendAccessToken", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    clearEnv();
    process.env.MAILBOX_SEND_APP_CLIENT_ID = "mailbox-app";
    process.env.MAILBOX_SEND_APP_CLIENT_SECRET = "mailbox-secret";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    evictMailboxSendToken(OWN);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("requests a Graph token for the dedicated app against the given tenant and returns its tid; caches it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: tokenFor({ tid: OWN, roles: ["Mail.Send"] }), expires_in: 3599 }), { status: 200 }),
    );
    const r = await getMailboxSendAccessToken(OWN);
    expect(r).toMatchObject({ ok: true, tenantId: OWN });

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe(`https://login.microsoftonline.com/${OWN}/oauth2/v2.0/token`);
    const body = new URLSearchParams(init.body);
    expect(body.get("client_id")).toBe("mailbox-app");
    expect(body.get("client_secret")).toBe("mailbox-secret");
    expect(body.get("scope")).toBe("https://graph.microsoft.com/.default");

    await getMailboxSendAccessToken(OWN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a missing service principal as a consent failure and a bad secret as not", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_client", error_description: "AADSTS7000229: The client application is missing service principal" }), { status: 400 }),
    );
    expect(await getMailboxSendAccessToken(OWN)).toMatchObject({ ok: false, consent: true, status: 400 });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." }), { status: 401 }),
    );
    expect(await getMailboxSendAccessToken(OWN)).toMatchObject({ ok: false, consent: false, status: 401 });
  });
});
