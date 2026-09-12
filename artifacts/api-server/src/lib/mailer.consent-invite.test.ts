/**
 * Regression test for #3067 — `consent-invite` now has a real `email_templates`
 * row, so `sendEmailFromTemplate("consent-invite", ...)` (the call site in
 * admin-clients.ts:872-879) must render from that DB row rather than falling
 * through to the hardcoded default subject/body it's passed as a fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  emailTemplatesTable: {},
  emailEventsTable: {},
  failedNotificationsTable: {},
  clientHealthHistoryTable: {},
  mspMailboxConnectorsTable: {},
  mspsTable: {},
  usersTable: {},
}));

function makeLoggerMock(): { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; child: ReturnType<typeof vi.fn> } {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLoggerMock()),
  };
}

vi.mock("./logger.ts", () => ({
  logger: makeLoggerMock(),
}));

const sendMailViaGraph = vi.fn().mockResolvedValue(undefined);

vi.mock("./graph.ts", () => ({
  graphCredentialsPresent: vi.fn(() => true),
  sendMailViaGraph: (...args: unknown[]) => sendMailViaGraph(...args),
  sendMailViaGraphForMsp: vi.fn(),
  mtAppCredentialsPresent: vi.fn(() => true),
  ConsentRevokedError: class ConsentRevokedError extends Error {},
}));

vi.mock("./tenant-signals.ts", () => ({
  computeTenantHealthVars: vi.fn(),
}));

vi.mock("./portal-url.ts", () => ({
  getMspPortalBaseUrl: vi.fn(() => "https://portal.example.com"),
}));

// Import after mocks.
import { sendEmailFromTemplate } from "./mailer.ts";
import { db } from "@workspace/db";

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
    values: vi.fn().mockReturnValue({ catch: vi.fn() }),
  };
  return chain as AnyMock;
}

const DEFAULT_SUBJECT = "Connect your Microsoft 365 to get started with Shane McCaw Consulting";
const DEFAULT_BODY_HTML = `<p>Hi Test Client,</p><p>this is the hardcoded fallback body, not the DB template</p>`;

describe("sendEmailFromTemplate('consent-invite', ...) — #3067", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GRAPH_MAIL_USER_ID = "noreply@example.com";
    sendMailViaGraph.mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue(makeInsertChain());
  });

  it("renders the real DB row's subject/body and substitutes {{clientName}}/{{consentLink}}, not the hardcoded fallback", async () => {
    // 1st db.select() call is getEmailTemplateOrFallback's consent-invite lookup;
    // 2nd is brandedEmail's branded-layout lookup (no row → falls back to the
    // hardcoded wrapper, which is unrelated to what this test is verifying).
    vi.mocked(db.select)
      .mockReturnValueOnce(makeSelectChain([{
        subject: "Connect your Microsoft 365 to get started with Shane McCaw Consulting",
        bodyHtml: `<p>Hi {{clientName}},</p><p><a href="{{consentLink}}">Connect Microsoft 365 →</a></p>`,
      }]))
      .mockReturnValueOnce(makeSelectChain([]));

    await sendEmailFromTemplate(
      "consent-invite",
      "client@example.com",
      { clientName: "Test Client", consentLink: "https://example.com/consent/abc123" },
      DEFAULT_SUBJECT,
      DEFAULT_BODY_HTML,
    );

    expect(sendMailViaGraph).toHaveBeenCalledTimes(1);
    const call = sendMailViaGraph.mock.calls[0][0];
    expect(call.subject).toBe(DEFAULT_SUBJECT);
    expect(call.htmlBody).toContain("Hi Test Client,");
    expect(call.htmlBody).toContain("https://example.com/consent/abc123");
    // Proves the DB template rendered, not the hardcoded default passed as fallback.
    expect(call.htmlBody).not.toContain("hardcoded fallback body");
  });

  it("falls back to the hardcoded default when no DB row exists (defensive — DB down or row deleted)", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeSelectChain([])) // no consent-invite row
      .mockReturnValueOnce(makeSelectChain([])); // no branded-layout row either

    await sendEmailFromTemplate(
      "consent-invite",
      "client@example.com",
      { clientName: "Test Client", consentLink: "https://example.com/consent/abc123" },
      DEFAULT_SUBJECT,
      DEFAULT_BODY_HTML,
    );

    expect(sendMailViaGraph).toHaveBeenCalledTimes(1);
    const call = sendMailViaGraph.mock.calls[0][0];
    expect(call.subject).toBe(DEFAULT_SUBJECT);
    expect(call.htmlBody).toContain("hardcoded fallback body");
  });
});
