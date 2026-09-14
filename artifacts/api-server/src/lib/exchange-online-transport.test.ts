/**
 * #3948 — unit tests for the exchange-online:// transport's pure mapping
 * layer (scheme detection, endpoint parsing, body→named-parameter mapping,
 * PsExecutionError classification). The tenant-bound wrapper in
 * workflow-executor.ts is exercised live against the container once #3530
 * (disabled Azure subscription) clears — these tests cover everything that
 * doesn't need the container.
 */
import { describe, it, expect } from "vitest";
import {
  EXCHANGE_ONLINE_CMDLET_KEYS,
  isExchangeOnlineEndpoint,
  parseExchangeOnlineEndpoint,
  buildPsExecutionParams,
  classifyPsExecutionFailure,
} from "./exchange-online-transport.ts";

describe("isExchangeOnlineEndpoint", () => {
  it("detects the scheme, case-insensitively", () => {
    expect(isExchangeOnlineEndpoint("exchange-online://Set-Mailbox")).toBe(true);
    expect(isExchangeOnlineEndpoint("Exchange-Online://Set-Mailbox")).toBe(true);
  });

  it("rejects Graph paths and absolute URLs", () => {
    expect(isExchangeOnlineEndpoint("/users/abc/authentication/methods")).toBe(false);
    expect(isExchangeOnlineEndpoint("https://graph.microsoft.com/v1.0/users")).toBe(false);
    expect(isExchangeOnlineEndpoint("")).toBe(false);
  });
});

describe("parseExchangeOnlineEndpoint", () => {
  it("maps every allowlisted cmdlet to its container cmdletKey", () => {
    for (const [cmdlet, cmdletKey] of Object.entries(EXCHANGE_ONLINE_CMDLET_KEYS)) {
      const res = parseExchangeOnlineEndpoint(`exchange-online://${cmdlet}`);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.parsed.cmdlet).toBe(cmdlet);
        expect(res.parsed.cmdletKey).toBe(cmdletKey);
      }
    }
  });

  it("fails closed on a cmdlet with no allowlisted key (New-TransportRule is deliberately unmapped)", () => {
    const res = parseExchangeOnlineEndpoint("exchange-online://New-TransportRule");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("New-TransportRule");
  });

  it("fails closed on an empty cmdlet and on a non-scheme endpoint", () => {
    expect(parseExchangeOnlineEndpoint("exchange-online://").ok).toBe(false);
    expect(parseExchangeOnlineEndpoint("/users/abc").ok).toBe(false);
  });
});

describe("buildPsExecutionParams", () => {
  it("passes values through, appends Organization last, preserves null and real booleans", () => {
    // action.remove-forwarding-rule's real body shape: null clears the
    // forward, false is a literal JSON boolean.
    const res = buildPsExecutionParams(
      { Identity: "user@contoso.com", ForwardingSmtpAddress: null, DeliverToMailboxAndForward: false },
      "contoso.onmicrosoft.com",
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.params).toEqual({
        Identity: "user@contoso.com",
        ForwardingSmtpAddress: null,
        DeliverToMailboxAndForward: false,
        Organization: "contoso.onmicrosoft.com",
      });
    }
  });

  it("coerces interpolated 'true'/'false' strings to booleans (PS bool params can't bind strings)", () => {
    // action.toggle-litigation-hold: {{enabled}} interpolates as a string.
    const res = buildPsExecutionParams({ Identity: "m", LitigationHoldEnabled: "true" }, "org");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.params.LitigationHoldEnabled).toBe(true);

    const res2 = buildPsExecutionParams({ Identity: "m", LitigationHoldEnabled: "False" }, "org");
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.params.LitigationHoldEnabled).toBe(false);
  });

  it("does not coerce ordinary strings", () => {
    const res = buildPsExecutionParams({ MaxSendSize: "0B", ProhibitSendQuota: "50GB" }, "org");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.params.MaxSendSize).toBe("0B");
      expect(res.params.ProhibitSendQuota).toBe("50GB");
    }
  });

  it("rejects a body that names a reserved connection field, case-insensitively", () => {
    expect(buildPsExecutionParams({ Organization: "evil.example" }, "org").ok).toBe(false);
    expect(buildPsExecutionParams({ tenantId: "someone-else" }, "org").ok).toBe(false);
  });
});

describe("classifyPsExecutionFailure", () => {
  it("maps each PsExecutionError kind onto the existing errorType union", () => {
    expect(classifyPsExecutionFailure({ kind: "auth_failed", message: "" }))
      .toEqual({ errorType: "insufficient_privilege", status: 502 });
    expect(classifyPsExecutionFailure({ kind: "cmdlet_unavailable", message: "" }))
      .toEqual({ errorType: "insufficient_privilege", status: 500 });
    expect(classifyPsExecutionFailure({ kind: "script_error", message: "" }))
      .toEqual({ errorType: "bad_request", status: 400 });
    expect(classifyPsExecutionFailure({ kind: "unreachable", message: "" }))
      .toEqual({ errorType: "unexpected", status: 0 });
  });
});

describe("real template body shapes map end-to-end through parse + build", () => {
  // The 12 supported baseline_action_templates rows' endpoint/body pairs as
  // they exist in the DB (action.set-mail-flow-rule excluded on purpose —
  // its New-TransportRule "Condition" param defect is a filed finding).
  // Bodies here are post-interpolation shapes: {{var}}s become strings.
  const templates: Array<{ templateId: string; endpoint: string; body: Record<string, unknown> }> = [
    { templateId: "action.block-outbound-send", endpoint: "exchange-online://Set-Mailbox", body: { Identity: "mbx", MaxSendSize: "0B" } },
    { templateId: "action.convert-user-to-shared-mailbox", endpoint: "exchange-online://Set-Mailbox", body: { Type: "Shared", Identity: "upn" } },
    { templateId: "action.create-distribution-list", endpoint: "exchange-online://New-DistributionGroup", body: { Name: "n", PrimarySmtpAddress: "a@b.c" } },
    { templateId: "action.create-room-mailbox", endpoint: "exchange-online://New-Mailbox", body: { Name: "n", Room: true, PrimarySmtpAddress: "a@b.c" } },
    { templateId: "action.create-shared-mailbox", endpoint: "exchange-online://New-Mailbox", body: { Name: "n", Shared: true, PrimarySmtpAddress: "a@b.c" } },
    { templateId: "action.enable-archive-and-quota", endpoint: "exchange-online://Set-Mailbox", body: { Identity: "mbx", ProhibitSendQuota: "50GB" } },
    { templateId: "action.grant-full-access-delegate", endpoint: "exchange-online://Add-MailboxPermission", body: { User: "d", Identity: "mbx", AccessRights: "FullAccess" } },
    { templateId: "action.grant-send-as", endpoint: "exchange-online://Add-RecipientPermission", body: { Trustee: "d", Identity: "mbx", AccessRights: "SendAs" } },
    { templateId: "action.remove-forwarding-rule", endpoint: "exchange-online://Set-Mailbox", body: { Identity: "upn", ForwardingSmtpAddress: null, DeliverToMailboxAndForward: false } },
    { templateId: "action.set-forwarding-rule", endpoint: "exchange-online://Set-Mailbox", body: { Identity: "upn", ForwardingSmtpAddress: "f@b.c", DeliverToMailboxAndForward: true } },
    { templateId: "action.toggle-litigation-hold", endpoint: "exchange-online://Set-Mailbox", body: { Identity: "mbx", LitigationHoldEnabled: "true" } },
    { templateId: "microrem.enable-mailbox-archive", endpoint: "exchange-online://Enable-Mailbox", body: { Archive: true, Identity: "upn" } },
  ];

  for (const t of templates) {
    it(t.templateId, () => {
      const parsed = parseExchangeOnlineEndpoint(t.endpoint);
      expect(parsed.ok).toBe(true);
      const built = buildPsExecutionParams(t.body, "mccawsoft2.onmicrosoft.com");
      expect(built.ok).toBe(true);
      if (built.ok) expect(built.params.Organization).toBe("mccawsoft2.onmicrosoft.com");
    });
  }
});
