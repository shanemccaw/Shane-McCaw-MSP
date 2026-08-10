/**
 * Regression tests for the #656 fix: account activation (POST /api/auth/setup-password
 * and POST /api/auth/forgot-password) must not hand a real password + session to a
 * consent-time Prospect who was never actually granted anything — a `passwordHash IS
 * NULL` account created before payment even starts is otherwise indistinguishable from
 * a legitimate account mid-setup.
 *
 * Both routes now require >=1 client_services row for the account (the same invariant
 * every OTHER legitimate account-setup email in this codebase already relies on before
 * issuing one — portal-checkout-free.ts's claim-free flow, admin-clients.ts's
 * resend-invite).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.JWT_SECRET = "activation-entitlement-test-secret-abc";

// ── Mock DB state ─────────────────────────────────────────────────────────────
// select() calls consume dbSelectQueue in the exact order the route issues them.
// insert() calls into accountSetupTokensTable are tracked separately so the
// forgot-password tests can assert whether a setup link was actually issued.

let dbSelectQueue: unknown[][] = [];
let accountSetupTokenInserts: unknown[] = [];

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
        if (table === accountSetupTokensTableRef) accountSetupTokenInserts.push(vals);
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

// A distinct object identity so the mock insert() can tell which table an
// insert targeted — the real @workspace/db module exports one object per table.
const accountSetupTokensTableRef = { __name: "account_setup_tokens" };

mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    usersTable: {},
    mspsTable: {},
    mspRefreshTokensTable: {},
    passwordResetTokensTable: {},
    impersonationTokensTable: {},
    accountSetupTokensTable: accountSetupTokensTableRef,
    mfaEnrollmentsTable: {},
    webauthnCredentialsTable: {},
    mspAuditLogsTable: {},
    mspServiceAccountsTable: {},
    clientServicesTable: {},
    servicesTable: {},
    platformLogStreamTable: {},
  },
});

mock.module("express-rate-limit", {
  defaultExport: () => (_req: unknown, _res: unknown, next: () => void) => next(),
});

mock.module("bcryptjs", {
  defaultExport: { compare: async () => false, hash: async () => "hashed" },
});

mock.module("../lib/mailer.ts", {
  namedExports: {
    sendEmailFromTemplate: async () => {},
    passwordResetEmail: () => ({ subject: "", html: "" }),
  },
});

mock.module("../lib/portal-url.ts", {
  namedExports: {
    getPortalBaseUrl: () => "https://example.com",
    buildAccountSetupUrl: () => "https://example.com/account-setup?token=test",
  },
});

mock.module("./mfa.ts", {
  namedExports: { signMfaToken: () => "mfa-token" },
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

// logger.ts's transitive deps (log-stream-writer.ts, exception-tracker.ts, ...)
// pull in a much larger slice of @workspace/db than this route touches — mock
// it directly rather than growing the db mock to match an unrelated chain.
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
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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

// ── Canned rows ──────────────────────────────────────────────────────────────

const PROSPECT_USER_ID = 501;

function makeSetupTokenRecord(overrides: Partial<{ usedAt: Date | null; expiresAt: Date }> = {}) {
  return {
    id: 1,
    token: "test-setup-token-abc123",
    userId: PROSPECT_USER_ID,
    usedAt: overrides.usedAt ?? null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
  };
}

const fakeProspectUser = {
  id: PROSPECT_USER_ID,
  email: "prospect@tenant5.test",
  name: "Free Scan Hopeful",
  role: "client",
  passwordHash: null,
  mspRole: null,
  mspId: null,
  tenantId: null,
  company: null,
  phone: null,
  address: null,
  addressCity: null,
  addressState: null,
  addressZip: null,
};

// ── Request helpers ───────────────────────────────────────────────────────────

async function postSetupPassword(token: string, password = "supersecret1"): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/auth/setup-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}

async function postForgotPassword(email: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("setup-password — POST /api/auth/setup-password (#656 entitlement gate)", () => {
  describe("unentitled account (no client_services row) → 409, no password set", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      // Queue: [setup-token record, entitlement check (empty = not entitled)]
      dbSelectQueue = [[makeSetupTokenRecord()], []];
      ({ status, json } = await postSetupPassword("test-setup-token-abc123"));
    });

    it("returns HTTP 409", () => {
      assert.equal(status, 409, `expected 409, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("error identifies the missing entitlement, not a generic token error", () => {
      assert.equal(json.error, "account_not_entitled");
    });

    it("does not return an accessToken", () => {
      assert.equal(json.accessToken, undefined);
    });
  });

  describe("entitled account (>=1 client_services row) → 200, session issued", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      // Queue: [setup-token record, entitlement row, re-fetched user, getMspClaims user row]
      dbSelectQueue = [
        [makeSetupTokenRecord()],
        [{ id: 900 }],
        [fakeProspectUser],
        [{ mspRole: null, mspId: null, tenantId: null }],
      ];
      ({ status, json } = await postSetupPassword("test-setup-token-abc123"));
    });

    it("returns HTTP 200", () => {
      assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("returns an accessToken", () => {
      assert.ok(
        typeof json.accessToken === "string" && (json.accessToken as string).length > 0,
        `expected accessToken, got: ${JSON.stringify(json)}`,
      );
    });
  });

  describe("invalid/expired token → 400 before any entitlement check runs", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      dbSelectQueue = [[]]; // token not found
      ({ status, json } = await postSetupPassword("nonexistent-token"));
    });

    it("returns HTTP 400", () => {
      assert.equal(status, 400, `expected 400, got ${status}; body: ${JSON.stringify(json)}`);
    });
  });
});

describe("forgot-password — POST /api/auth/forgot-password (#656 issuance-side gate)", () => {
  describe("passwordless, unentitled account → no account-setup link issued", () => {
    before(async () => {
      accountSetupTokenInserts = [];
      // Queue: [user lookup by email, entitlement check (empty = not entitled)]
      dbSelectQueue = [[fakeProspectUser], []];
      await postForgotPassword(fakeProspectUser.email);
      // forgot-password responds immediately then continues async — give the
      // fire-and-forget tail time to run (matches the pattern already used in
      // portal-checkout-webhook.test.ts for this exact codebase idiom).
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("never inserts an account_setup_tokens row", () => {
      assert.equal(
        accountSetupTokenInserts.length,
        0,
        `expected no account-setup token issued to an unentitled account, got: ${JSON.stringify(accountSetupTokenInserts)}`,
      );
    });
  });

  describe("passwordless, entitled account → account-setup link issued as before", () => {
    before(async () => {
      accountSetupTokenInserts = [];
      // Queue: [user lookup by email, entitlement row]
      dbSelectQueue = [[fakeProspectUser], [{ id: 900 }]];
      await postForgotPassword(fakeProspectUser.email);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("issues exactly one account_setup_tokens row", () => {
      assert.equal(
        accountSetupTokenInserts.length,
        1,
        `expected one account-setup token issued to an entitled account, got: ${JSON.stringify(accountSetupTokenInserts)}`,
      );
    });
  });
});
