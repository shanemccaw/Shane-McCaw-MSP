/**
 * Tests for the impersonation token exchange in auth.ts:
 *   POST /api/auth/impersonate-exchange
 *
 * Critical behaviours verified:
 *   1. Expired token → 401
 *   2. Already-consumed (usedAt set) token → 401
 *   3. Valid token → 200 + access JWT
 *   4. Billing attribution: JWT carries mspId and impersonatedMspId equal to
 *      the target user's mspId (never the actor's MSP)
 *   5. MSP claims (mspRole, mspId, customerId) are injected from target's
 *      msp_users row, not from the actor's claims
 *   6. Single-use enforcement: a second exchange with the same token → 401
 *      (the mock simulates the DB returning usedAt on the second call)
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";

const TEST_JWT_SECRET = "impersonation-auth-test-secret-abc";
process.env.JWT_SECRET = TEST_JWT_SECRET;

// ── Mock DB state ─────────────────────────────────────────────────────────────
// The exchange handler calls:
//   1. select from impersonationTokensTable  → token record
//   2. update impersonationTokensTable       → no return value
//   3. select from usersTable               → target user
//   4. select from mspUsersTable (getMspClaims) → msp_users row
//   5. insert into mspAuditLogsTable        → non-fatal, ignored

let dbSelectQueue: unknown[][] = [];

function makeMockDb() {
  return {
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: number) => dbSelectQueue.shift() ?? [],
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: async (_vals: unknown) => [],
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

// ── Mocks ─────────────────────────────────────────────────────────────────────

mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    usersTable: {},
    mspUsersTable: {},
    mspsTable: {},
    mspRefreshTokensTable: {},
    passwordResetTokensTable: {},
    impersonationTokensTable: {},
    accountSetupTokensTable: {},
    mfaEnrollmentsTable: {},
    webauthnCredentialsTable: {},
    mspAuditLogsTable: {},
    mspServiceAccountsTable: {},
    mspCustomersTable: {},
  },
});

mock.module("express-rate-limit", {
  defaultExport: () => (_req: unknown, _res: unknown, next: () => void) => next(),
});

mock.module("bcryptjs", {
  defaultExport: { compare: async () => false, hash: async () => "" },
});

mock.module("../lib/mailer.ts", {
  namedExports: {
    sendEmailFromTemplate: async () => {},
    passwordResetEmail: () => ({ subject: "", html: "" }),
    PORTAL_URL: "https://example.com",
  },
});

mock.module("../lib/portal-url.ts", {
  namedExports: { getPortalBaseUrl: () => "https://example.com" },
});

// auth.ts now uses .ts extensions on local imports — mocks must match
mock.module("./mfa.ts", {
  namedExports: { signMfaToken: () => "mfa-token" },
});

mock.module("../lib/event-bus.ts", {
  namedExports: {
    dispatchEvent: async () => {},
    fireWorkflowsForEvent: async () => {},
    EVENT_TYPES: {
      IMPERSONATION_SESSION_STARTED: "auth.impersonation.session_started",
    },
    systemActor: () => ({}),
    userActor: () => ({}),
    impersonationActor: () => ({}),
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

// ── Canned DB rows ────────────────────────────────────────────────────────────

const TARGET_USER_ID = 77;
const ACTOR_ADMIN_ID = 1;
const TARGET_MSP_ID = 5;
const TARGET_CUSTOMER_ID = 22;

function makeTokenRecord(overrides: Partial<{
  usedAt: Date | null;
  expiresAt: Date;
}> = {}) {
  return {
    id: 1,
    token: "test-impersonation-token-abc123",
    clientUserId: TARGET_USER_ID,
    adminUserId: ACTOR_ADMIN_ID,
    usedAt: overrides.usedAt ?? null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
    createdAt: new Date(),
  };
}

const fakeTargetUser = {
  id: TARGET_USER_ID,
  email: "customer@tenant5.test",
  name: "Target User",
  role: "client",
  passwordHash: null,
  company: null,
  phone: null,
  address: null,
  addressCity: null,
  addressState: null,
  addressZip: null,
};

const fakeMspUserRow = {
  id: 200,
  userId: TARGET_USER_ID,
  mspId: TARGET_MSP_ID,
  customerId: TARGET_CUSTOMER_ID,
  mspRole: "CustomerUser",
  isActive: true,
};

// ── Request helper ────────────────────────────────────────────────────────────

async function postExchange(token: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/auth/impersonate-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("impersonate-exchange — POST /api/auth/impersonate-exchange", () => {

  describe("missing token → 400", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      dbSelectQueue = [];
      const res = await fetch(`${baseUrl}/api/auth/impersonate-exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      json = await res.json() as Record<string, unknown>;
      status = res.status;
    });

    it("returns HTTP 400", () => {
      assert.equal(status, 400, `expected 400, got ${status}; body: ${JSON.stringify(json)}`);
    });
  });

  describe("expired token → 401", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      const expiredRecord = makeTokenRecord({
        expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      });
      dbSelectQueue = [[expiredRecord]];
      ({ status, json } = await postExchange("expired-token-xyz"));
    });

    it("returns HTTP 401", () => {
      assert.equal(status, 401, `expected 401, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("error mentions invalid or expired", () => {
      assert.ok(
        typeof json.error === "string" &&
          (json.error.toLowerCase().includes("invalid") || json.error.toLowerCase().includes("expired")),
        `expected "invalid" or "expired" in error, got: ${JSON.stringify(json.error)}`,
      );
    });
  });

  describe("already-used token → 401", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      const usedRecord = makeTokenRecord({ usedAt: new Date(Date.now() - 60_000) });
      dbSelectQueue = [[usedRecord]];
      ({ status, json } = await postExchange("used-token-xyz"));
    });

    it("returns HTTP 401", () => {
      assert.equal(status, 401, `expected 401, got ${status}; body: ${JSON.stringify(json)}`);
    });
  });

  describe("unknown token (not in DB) → 401", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      dbSelectQueue = [[/* empty — token not found */]];
      ({ status, json } = await postExchange("nonexistent-token"));
    });

    it("returns HTTP 401", () => {
      assert.equal(status, 401, `expected 401, got ${status}; body: ${JSON.stringify(json)}`);
    });
  });

  describe("valid token → 200 with full MSP claims and billing attribution", () => {
    let status: number;
    let json: Record<string, unknown>;
    let decodedJwt: Record<string, unknown>;

    before(async () => {
      // Queue: [impersonation record, target user, msp_users row]
      dbSelectQueue = [[makeTokenRecord()], [fakeTargetUser], [fakeMspUserRow]];
      ({ status, json } = await postExchange("test-impersonation-token-abc123"));

      if (json.accessToken) {
        decodedJwt = jwt.decode(json.accessToken as string) as Record<string, unknown>;
      }
    });

    it("returns HTTP 200", () => {
      assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("returns an accessToken string", () => {
      assert.ok(
        typeof json.accessToken === "string" && (json.accessToken as string).length > 0,
        `expected accessToken in response, got: ${JSON.stringify(json)}`,
      );
    });

    it("JWT carries the target user's identity", () => {
      assert.equal(decodedJwt?.id, TARGET_USER_ID);
      assert.equal(decodedJwt?.email, fakeTargetUser.email);
    });

    it("JWT carries impersonatedBy = actor admin ID", () => {
      assert.equal(
        decodedJwt?.impersonatedBy,
        ACTOR_ADMIN_ID,
        `expected impersonatedBy=${ACTOR_ADMIN_ID}, got: ${JSON.stringify(decodedJwt?.impersonatedBy)}`,
      );
    });

    it("JWT carries the target user's mspId (MSP claims injected from msp_users)", () => {
      assert.equal(
        decodedJwt?.mspId,
        TARGET_MSP_ID,
        `expected mspId=${TARGET_MSP_ID} from target user's msp_users row, got: ${JSON.stringify(decodedJwt?.mspId)}`,
      );
    });

    it("JWT carries impersonatedMspId = target mspId (billing attribution)", () => {
      assert.equal(
        decodedJwt?.impersonatedMspId,
        TARGET_MSP_ID,
        `expected impersonatedMspId=${TARGET_MSP_ID} for AI billing, got: ${JSON.stringify(decodedJwt?.impersonatedMspId)}`,
      );
    });

    it("JWT carries the target user's mspRole from msp_users", () => {
      assert.equal(
        decodedJwt?.mspRole,
        fakeMspUserRow.mspRole,
        `expected mspRole=${fakeMspUserRow.mspRole}, got: ${JSON.stringify(decodedJwt?.mspRole)}`,
      );
    });

    it("JWT carries the target user's customerId from msp_users", () => {
      assert.equal(
        decodedJwt?.customerId,
        TARGET_CUSTOMER_ID,
        `expected customerId=${TARGET_CUSTOMER_ID}, got: ${JSON.stringify(decodedJwt?.customerId)}`,
      );
    });

    it("response user object also carries impersonatedMspId", () => {
      const user = json.user as Record<string, unknown>;
      assert.equal(
        user?.impersonatedMspId,
        TARGET_MSP_ID,
        `expected user.impersonatedMspId=${TARGET_MSP_ID}, got: ${JSON.stringify(user?.impersonatedMspId)}`,
      );
    });
  });

  describe("valid token for user with no MSP row (legacy client) → 200, no MSP claims", () => {
    let status: number;
    let json: Record<string, unknown>;
    let decodedJwt: Record<string, unknown>;

    before(async () => {
      // getMspClaims returns empty — mspUsersTable has no row for this user
      dbSelectQueue = [[makeTokenRecord()], [fakeTargetUser], [/* no msp_users row */]];
      ({ status, json } = await postExchange("test-impersonation-token-abc123"));

      if (json.accessToken) {
        decodedJwt = jwt.decode(json.accessToken as string) as Record<string, unknown>;
      }
    });

    it("returns HTTP 200", () => {
      assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("JWT has no impersonatedMspId (no MSP to bill)", () => {
      assert.equal(
        decodedJwt?.impersonatedMspId,
        undefined,
        `expected no impersonatedMspId, got: ${JSON.stringify(decodedJwt?.impersonatedMspId)}`,
      );
    });

    it("JWT has no mspId", () => {
      assert.equal(
        decodedJwt?.mspId,
        undefined,
        `expected no mspId, got: ${JSON.stringify(decodedJwt?.mspId)}`,
      );
    });

    it("JWT still carries impersonatedBy", () => {
      assert.equal(decodedJwt?.impersonatedBy, ACTOR_ADMIN_ID);
    });
  });
});
