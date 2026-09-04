/**
 * Tests for the MSP team invite route:
 *   POST /api/msp/customers/:customerId/team/invite  (msp-team.ts)
 *
 * Covers the cross-tenant data-integrity bug fixed in Git #2822: the invite handler
 * previously wrote the CALLER's own session `mspId` claim onto the new `users` row
 * instead of the TARGET tenant's real owning MSP (`tenantsTable.mspId`). For an
 * MSPAdmin/MSPOperator caller the two values always match (`assertCustomerAccess`
 * only lets that tier reach a customer whose `tenantsTable.mspId` already equals
 * their own), so the bug was masked. For a PlatformAdmin caller — cross-MSP access,
 * `assertCustomerAccess` returns true unconditionally — the values can genuinely
 * differ, and the new row's `mspId` must come from the target tenant, not the caller.
 *
 * Critical behaviours verified:
 *   1. PlatformAdmin inviting into a customer under a DIFFERENT MSP than their own
 *      session mspId → the inserted row's mspId is the TARGET tenant's mspId, not
 *      the caller's own (the real regression this issue fixes).
 *   2. MSPAdmin inviting into their own MSP's customer → inserted row's mspId still
 *      matches (same value either way for this tier — non-regression check).
 *   3. Inviting into a customerId with no matching tenant row → 404, no insert.
 *
 * requireAuth.ts is intentionally NOT mocked so requireRole/assertCustomerAccess
 * enforce real JWT-based scope checks against genuine tokens — same discipline as
 * msp-staff.test.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";

const TEST_JWT_SECRET = "msp-team-invite-test-secret-xyz";
process.env.JWT_SECRET = TEST_JWT_SECRET;

// ── JWT helpers ────────────────────────────────────────────────────────────────

function makeJwt(claims: Record<string, unknown>): string {
  return jwt.sign(claims, TEST_JWT_SECRET, { expiresIn: "15m" });
}

const platformAdminToken = makeJwt({
  id: 1,
  email: "platform@admin.test",
  role: "admin",
  mspId: 1, // caller's OWN mspId — must NOT end up on the new row when it differs from the target tenant's
});

const mspAdminMsp1Token = makeJwt({
  id: 10,
  email: "admin@msp1.test",
  role: "client",
  mspId: 1,
  mspRole: "MSPAdmin",
});

// ── Mock DB state ─────────────────────────────────────────────────────────────
// Queue-based: each select() call shifts one item off the front.

let dbSelectQueue: unknown[][] = [];
let lastInsertValues: Record<string, unknown> | null = null;

function makeMockDb() {
  return {
    // `.where(...)` shifts exactly one queue item per real query call — the
    // result is both directly awaitable (`await db.select().from().where()`,
    // used by requireAuth.ts's resolveStaffScopedCustomerIds) AND chainable
    // with `.limit()` (used everywhere else in this file), both resolving to
    // the same shifted rows so a single query never consumes two queue items.
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          const rows = dbSelectQueue.shift() ?? [];
          const result = Promise.resolve(rows) as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> };
          result.limit = async (_n: number) => rows;
          return result;
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        lastInsertValues = vals;
        return {
          returning: async () => [{ id: 999, name: vals.name ?? null, email: vals.email }],
        };
      },
    }),
  };
}

// ── Register all mocks BEFORE msp-team.ts is imported ──────────────────────────
// NOTE: requireAuth.ts is NOT mocked — we rely on the real middleware.

mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    tenantsTable: {},
    mspsTable: {},
    usersTable: {},
    mfaEnrollmentsTable: {},
    webauthnCredentialsTable: {},
    userSessionsTable: {},
    passwordResetTokensTable: {},
    mfaChallengesTable: {},
    webauthnChallengesTable: {},
    mfaBypassCodesTable: {},
    // requireAuth.ts (left unmocked) imports this too.
    mspStaffCustomerScopesTable: {},
  },
});

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop,
  child: () => noopLogger,
};
mock.module("../lib/logger.ts", { namedExports: { logger: noopLogger } });

mock.module("../lib/session-tracking.ts", {
  namedExports: { revokeAllOtherSessions: async () => {} },
});
mock.module("../lib/audit.ts", {
  namedExports: { createAuditLog: async () => {} },
});
mock.module("../lib/portal-url.ts", {
  namedExports: {
    getPortalBaseUrl: () => "https://portal.test",
    getMspPortalBaseUrl: () => "https://msp.test",
    buildAccountSetupUrl: (token: string) => `https://portal.test/setup?token=${token}`,
  },
});
mock.module("../lib/mailer.ts", {
  namedExports: {
    sendEmailFromTemplate: async () => {},
    passwordResetEmail: () => ({ subject: "", html: "" }),
  },
});
mock.module("../lib/client-setup-token.ts", {
  namedExports: { ensureClientSetupToken: async (_userId: number) => ({ token: "fake-setup-token" }) },
});

// ── Import real msp-team router AFTER all mocks are registered ────────────────
const { default: mspTeamRouter } = await import("./msp-team.ts");

const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use((_req: unknown, _res: unknown, next: () => void) => {
  ((_req as Record<string, unknown>).log = noopLogger);
  next();
});
app.use("/api", mspTeamRouter);

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

// ── Request helper ────────────────────────────────────────────────────────────

async function postInvite(
  customerId: number,
  authToken: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(
    `${baseUrl}/api/msp/customers/${customerId}/team/invite`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("MSP team invite endpoint — POST /api/msp/customers/:customerId/team/invite", () => {

  describe("PlatformAdmin → customer under a DIFFERENT MSP → mspId is the TARGET tenant's (Git #2822)", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      lastInsertValues = null;
      // Handler makes 2 selects: tenantsTable (target tenant's real mspId = 2, NOT
      // the caller's own mspId claim of 1), then usersTable (existing-email check).
      dbSelectQueue = [[{ mspId: 2 }], []];
      ({ status, json } = await postInvite(20, platformAdminToken, {
        email: "newperson@beta.test",
        name: "New Person",
      }));
    });

    it("returns HTTP 201", () => {
      assert.equal(status, 201, `expected 201, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("inserted row's mspId is the TARGET tenant's mspId (2), not the caller's own mspId claim (1)", () => {
      assert.ok(lastInsertValues, "expected db.insert(usersTable).values(...) to have been called");
      assert.equal(
        (lastInsertValues as Record<string, unknown>).mspId,
        2,
        `expected inserted mspId=2 (target tenant's real owning MSP), got: ${JSON.stringify(lastInsertValues)}`,
      );
    });

    it("inserted row's tenantId is the target customerId", () => {
      assert.equal((lastInsertValues as Record<string, unknown>).tenantId, 20);
    });
  });

  describe("MSPAdmin → own MSP's customer → mspId still correct (non-regression)", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      lastInsertValues = null;
      // assertCustomerAccess for MSPAdmin does its own tenantsTable select (IDOR
      // check), then isCustomerBlockedByStaffScope's staff-scope select (empty =
      // unrestricted), then the handler's own target-tenant mspId lookup, then the
      // existing-email check.
      dbSelectQueue = [[{ id: 10 }], [], [{ mspId: 1 }], []];
      ({ status, json } = await postInvite(10, mspAdminMsp1Token, {
        email: "newperson@acme.test",
        name: "New Person",
      }));
    });

    it("returns HTTP 201", () => {
      assert.equal(status, 201, `expected 201, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("inserted row's mspId matches the caller's own MSP (1) — same tenant, no cross-MSP mismatch", () => {
      assert.equal((lastInsertValues as Record<string, unknown>).mspId, 1);
    });
  });

  describe("PlatformAdmin → customerId with no matching tenant → 404, no insert", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      lastInsertValues = null;
      dbSelectQueue = [[]]; // tenantsTable lookup returns nothing
      ({ status, json } = await postInvite(999, platformAdminToken, {
        email: "nobody@nowhere.test",
      }));
    });

    it("returns HTTP 404", () => {
      assert.equal(status, 404, `expected 404, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("did not insert a user row", () => {
      assert.equal(lastInsertValues, null, "expected no db.insert(usersTable).values(...) call");
    });
  });
});
