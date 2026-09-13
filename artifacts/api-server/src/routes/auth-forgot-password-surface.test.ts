/**
 * Regression tests for #3910: POST /api/auth/forgot-password is shared by every
 * account type (customer portal users AND MSP console operators/admins live in
 * one users table and hit one route). The reset link the email hands out must be
 * surface-aware:
 *
 *   - a portal-originated request (no `surface`, or anything != "console") still
 *     gets the customer-portal reset link — byte-identical to the pre-#3910
 *     behaviour, no regression.
 *   - a console-originated request (`surface: "console"`, sent by
 *     msp-console/src/auth/authApi.ts) gets a link back to the console's own
 *     /msp-console/forgot-password?token= page.
 *
 * The reset-token VALIDATION route (POST /auth/reset-password) is surface-
 * agnostic and untouched — this only proves which URL the email hands out.
 *
 * No fixture data: each case drives a real HTTP request through the real auth
 * router and asserts the link actually passed to the mailer.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.JWT_SECRET = "forgot-password-surface-test-secret-abc";
// The portal branch reads PORTAL_BASE_URL directly (unchanged by #3910); pin it
// to a known value so the no-regression assertion is exact.
const PORTAL_BASE_URL = "https://portal.example.test";
process.env.PORTAL_BASE_URL = PORTAL_BASE_URL;

const CONSOLE_BASE_URL = "https://console.example.test/msp-console";

// ── Mock DB state ─────────────────────────────────────────────────────────────
// select() calls consume dbSelectQueue in order. Inserts into
// passwordResetTokensTable are captured so a test can read back the exact token
// the route minted and assert the emailed link carries it verbatim.

let dbSelectQueue: unknown[][] = [];
let passwordResetTokenInserts: Array<{ token: string }> = [];

const passwordResetTokensTableRef = { __name: "password_reset_tokens" };

function makeMockDb() {
  return {
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: number) => dbSelectQueue.shift() ?? [],
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (vals: unknown) => {
        if (table === passwordResetTokensTableRef) passwordResetTokenInserts.push(vals as { token: string });
        return [];
      },
    }),
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: async (_cond: unknown) => [],
      }),
    }),
    delete: (_table: unknown) => ({
      where: async (_cond: unknown) => [],
    }),
  };
}

mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    usersTable: {},
    mspsTable: {},
    mspRefreshTokensTable: {},
    passwordResetTokensTable: passwordResetTokensTableRef,
    impersonationTokensTable: {},
    accountSetupTokensTable: {},
    mfaEnrollmentsTable: {},
    webauthnCredentialsTable: {},
    mspAuditLogsTable: {},
    mspServiceAccountsTable: {},
    clientServicesTable: {},
    servicesTable: {},
    platformLogStreamTable: {},
    printTokensTable: {},
    documentPrintTokensTable: {},
    signupExchangeTokensTable: {},
  },
});

mock.module("express-rate-limit", {
  defaultExport: () => (_req: unknown, _res: unknown, next: () => void) => next(),
});

mock.module("bcryptjs", {
  defaultExport: { compare: async () => false, hash: async () => "hashed" },
});

// Capture the password-reset email the route dispatches so we can read the link.
let passwordResetSends: Array<{ to: string; resetLink: unknown }> = [];
mock.module("../lib/mailer.ts", {
  namedExports: {
    sendEmailFromTemplate: async (
      template: string,
      to: string,
      vars: Record<string, unknown>,
    ) => {
      if (template === "password-reset") passwordResetSends.push({ to, resetLink: vars?.resetLink });
    },
    passwordResetEmail: () => ({ subject: "", html: "" }),
  },
});

mock.module("../lib/portal-url.ts", {
  namedExports: {
    getPortalBaseUrl: () => "https://example.com/crm",
    getMspConsoleBaseUrl: () => CONSOLE_BASE_URL,
    buildAccountSetupUrl: () => "https://example.com/account-setup?token=test",
  },
});

mock.module("./mfa.ts", {
  namedExports: {
    signMfaToken: () => "mfa-token",
    getActiveMfaMethods: async (_userId: number) => [],
  },
});

mock.module("../lib/event-bus.ts", {
  namedExports: {
    dispatchEvent: async () => {},
    fireWorkflowsForEvent: async () => {},
    EVENT_TYPES: { AUTH_ACCOUNT_SETUP: "auth.account_setup", AUTH_LOGIN: "auth.login" },
    systemActor: () => ({}),
    userActor: () => ({}),
    impersonationActor: () => ({}),
  },
});

mock.module("../lib/session-tracking.ts", {
  namedExports: {
    createSession: async () => {},
    touchSessionByTokenHash: async () => {},
    revokeSessionByTokenHash: async () => {},
    revokeSessionById: async () => {},
    revokeAllOtherSessions: async () => 0,
    listActiveSessions: async () => [],
    listLoginHistory: async () => [],
  },
});

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module("../lib/logger.ts", {
  namedExports: {
    logger: { child: () => noopLog },
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
    requireCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    requireMspScope: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

// ── Import real auth router AFTER all mocks ────────────────────────────────────
const { default: authRouter } = await import("./auth.ts");

const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use("/api", authRouter);

let server: http.Server;
let baseUrl: string;

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);

after(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

// A real, password-having account — so forgot-password takes the reset branch
// (mints a password_reset_tokens row + sends the password-reset email) rather
// than the passwordless account-setup branch.
const userWithPassword = {
  id: 777,
  email: "operator@tenant.test",
  name: "Ops Person",
  role: "client",
  passwordHash: "$2a$12$alreadyset",
  mspRole: "MSPOperator",
  mspId: 1,
  tenantId: null,
};

async function postForgotPassword(body: Record<string, unknown>): Promise<void> {
  await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Route answers { ok: true } then continues fire-and-forget — let the tail run.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe("forgot-password surface routing — POST /api/auth/forgot-password (#3910)", () => {
  describe("portal-originated request (no surface field) → customer-portal reset link", () => {
    let resetLink: string;

    before(async () => {
      passwordResetSends = [];
      passwordResetTokenInserts = [];
      dbSelectQueue = [[userWithPassword]];
      await postForgotPassword({ email: userWithPassword.email });
      resetLink = passwordResetSends[0]?.resetLink as string;
    });

    it("sends exactly one password-reset email", () => {
      assert.equal(passwordResetSends.length, 1, `expected one send, got: ${JSON.stringify(passwordResetSends)}`);
    });

    it("links to the customer portal's /reset-password page, carrying the real minted token", () => {
      const token = passwordResetTokenInserts[0]?.token;
      assert.ok(token, "expected a password_reset_tokens row to be minted");
      assert.equal(resetLink, `${PORTAL_BASE_URL}/reset-password?token=${token}`);
    });

    it("does NOT point at the console", () => {
      assert.ok(!resetLink.includes("/msp-console"), `portal link leaked into console surface: ${resetLink}`);
    });
  });

  describe("console-originated request (surface: 'console') → MSP console reset link", () => {
    let resetLink: string;

    before(async () => {
      passwordResetSends = [];
      passwordResetTokenInserts = [];
      dbSelectQueue = [[userWithPassword]];
      await postForgotPassword({ email: userWithPassword.email, surface: "console" });
      resetLink = passwordResetSends[0]?.resetLink as string;
    });

    it("sends exactly one password-reset email", () => {
      assert.equal(passwordResetSends.length, 1, `expected one send, got: ${JSON.stringify(passwordResetSends)}`);
    });

    it("links to the console's own /msp-console/forgot-password page, carrying the real minted token", () => {
      const token = passwordResetTokenInserts[0]?.token;
      assert.ok(token, "expected a password_reset_tokens row to be minted");
      assert.equal(resetLink, `${CONSOLE_BASE_URL}/forgot-password?token=${token}`);
    });

    it("does NOT point at the customer portal", () => {
      assert.ok(!resetLink.startsWith(PORTAL_BASE_URL), `console link leaked into portal surface: ${resetLink}`);
    });
  });

  describe("unknown surface value → falls through to the portal (no regression)", () => {
    let resetLink: string;

    before(async () => {
      passwordResetSends = [];
      passwordResetTokenInserts = [];
      dbSelectQueue = [[userWithPassword]];
      await postForgotPassword({ email: userWithPassword.email, surface: "banana" });
      resetLink = passwordResetSends[0]?.resetLink as string;
    });

    it("links to the customer portal, not the console", () => {
      const token = passwordResetTokenInserts[0]?.token;
      assert.equal(resetLink, `${PORTAL_BASE_URL}/reset-password?token=${token}`);
    });
  });
});
