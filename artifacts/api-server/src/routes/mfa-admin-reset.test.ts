/**
 * mfa-admin-reset.test.ts
 *
 * Active Directory Phase 8 (Issue #68) added an ADMIN-initiated MFA reset path
 * to mfa.ts. The rule for that phase was "extend, do not fork": the admin path
 * must run the same per-method un-enrollment the self-service DELETE routes
 * have always run, not a second copy of it.
 *
 * These tests pin that down at the level the AD route test cannot, because that
 * suite mocks mfa.ts out entirely:
 *
 *   • unenrollMfaMethod() performs exactly the deletes each self-service route
 *     used to perform inline (and the self-service routes now call it);
 *   • a FULL reset additionally clears pending challenges and any UNUSED
 *     emergency bypass code — a live bypass code outliving an MFA reset would
 *     be an un-revoked way past MFA — while leaving used ones as audit record;
 *   • a single-method reset touches only that method;
 *   • POST /auth/mfa/admin/reset/:userId is admin-gated and audited.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["JWT_SECRET"] = "test-secret";

const ADMIN_PASS = "test-admin-pass";
const ACTOR_ID = 1;
const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

const { selectQueue, deletes, mockCreateAuditLog, mockSendEmailFromTemplate } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  deletes: [] as Array<{ table: string; where: unknown }>,
  mockCreateAuditLog: vi.fn(),
  mockSendEmailFromTemplate: vi.fn(),
}));

function table(name: string, ...columns: string[]) {
  const t: Record<string, unknown> = { __table: name };
  for (const c of columns) t[c] = `${name}.${c}`;
  return t;
}

vi.mock("@workspace/db", () => {
  function chain(): Record<string, unknown> {
    const self: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "innerJoin", "orderBy"]) self[m] = () => self;
    self.then = (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []);
    return self;
  }

  return {
    db: {
      select: vi.fn(() => chain()),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
      delete: vi.fn((t: { __table: string }) => ({
        where: vi.fn(async (where: unknown) => {
          deletes.push({ table: t.__table, where });
        }),
      })),
    },
    // msp_users was absorbed into users (#92) — its mspRole/mspId/customerId
    // columns now live on this row as mspRole/mspId/tenantId.
    usersTable: table("users", "id", "email", "name", "role", "mspRole", "mspId", "tenantId"),
    mfaEnrollmentsTable: table("mfa_enrollments", "userId", "method", "enabled", "encryptedSecret", "phone"),
    mfaChallengesTable: table("mfa_challenges", "id", "userId", "method", "expiresAt", "usedAt"),
    mfaBypassCodesTable: table("mfa_bypass_codes", "id", "userId", "usedAt", "expiresAt"),
    webauthnCredentialsTable: table("webauthn_credentials", "id", "userId", "credentialId"),
    webauthnChallengesTable: table("webauthn_challenges", "id", "userId", "purpose", "expiresAt"),
    mspRefreshTokensTable: table("msp_refresh_tokens", "userId", "tokenHash"),
  };
});

// Condition builders return inspectable descriptors so the assertions below can
// name the exact table+column each delete was scoped to.
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...c: unknown[]) => ({ op: "and", c }),
  gt: (a: unknown, b: unknown) => ({ op: "gt", a, b }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] !== `Bearer ${ADMIN_PASS}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = { id: ACTOR_ID, email: "admin@shanemccaw.consulting", name: "Platform Admin", role: "admin" };
    next();
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("../lib/audit", () => ({ createAuditLog: mockCreateAuditLog }));
vi.mock("../lib/mailer.ts", () => ({
  sendEmailFromTemplate: mockSendEmailFromTemplate,
  PORTAL_URL: "https://example.test/portal",
}));
vi.mock("../lib/session-tracking", () => ({ createSession: vi.fn() }));

/** Which methods `listEnrolledMfaMethods` should report, per call. */
function seedEnrollments(methods: string[], passkeyCredentials = 0) {
  selectQueue.push(methods.filter((m) => m !== "passkey").map((m) => ({ method: m })));
  selectQueue.push(Array.from({ length: passkeyCredentials }, (_, i) => ({ id: i + 1 })));
}

function deletedTables() {
  return deletes.map((d) => d.table);
}

function deleteFor(tableName: string) {
  return deletes.find((d) => d.table === tableName);
}

let mfa: typeof import("./mfa");
let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  deletes.length = 0;
  mockCreateAuditLog.mockResolvedValue(undefined);
  mockSendEmailFromTemplate.mockResolvedValue(undefined);

  mfa = await import("./mfa");
  app = express();
  app.use(express.json());
  app.use(mfa.default);
});

describe("unenrollMfaMethod — the single shared un-enrollment implementation", () => {
  it("clears only the TOTP enrollment row for totp", async () => {
    await mfa.unenrollMfaMethod(42, "totp");

    expect(deletedTables()).toEqual(["mfa_enrollments"]);
    expect(deleteFor("mfa_enrollments")?.where).toEqual({
      op: "and",
      c: [
        { op: "eq", a: "mfa_enrollments.userId", b: 42 },
        { op: "eq", a: "mfa_enrollments.method", b: "totp" },
      ],
    });
  });

  it("clears only the SMS enrollment row for sms", async () => {
    await mfa.unenrollMfaMethod(42, "sms");

    expect(deletedTables()).toEqual(["mfa_enrollments"]);
    expect(deleteFor("mfa_enrollments")?.where).toMatchObject({
      c: [expect.anything(), { op: "eq", a: "mfa_enrollments.method", b: "sms" }],
    });
  });

  it("clears the real credentials AND the enrollment row for passkey — the credential is what actually authenticates", async () => {
    await mfa.unenrollMfaMethod(42, "passkey");

    expect(deletedTables()).toEqual(["webauthn_credentials", "mfa_enrollments"]);
  });
});

describe("resetMfaForUser", () => {
  it("full reset clears every method, pending challenges, and UNUSED bypass codes", async () => {
    seedEnrollments(["totp", "sms"], 2);

    const { clearedMethods } = await mfa.resetMfaForUser(42);

    expect(clearedMethods).toEqual(["totp", "sms", "passkey"]);
    expect(deletedTables()).toEqual([
      "mfa_enrollments", // totp
      "mfa_enrollments", // sms
      "webauthn_credentials", // passkey credentials
      "mfa_enrollments", // passkey enrollment
      "mfa_challenges",
      "webauthn_challenges",
      "mfa_bypass_codes",
    ]);

    // Used bypass codes are the audit record of a real sign-in and must survive
    // — only un-consumed ones are purged.
    expect(deleteFor("mfa_bypass_codes")?.where).toEqual({
      op: "and",
      c: [
        { op: "eq", a: "mfa_bypass_codes.userId", b: 42 },
        { op: "isNull", a: "mfa_bypass_codes.usedAt" },
      ],
    });
  });

  it("reports an empty cleared list for an account with no MFA at all, and still leaves no residue", async () => {
    seedEnrollments([], 0);

    const { clearedMethods } = await mfa.resetMfaForUser(42);

    expect(clearedMethods).toEqual([]);
    expect(deletedTables()).toContain("mfa_bypass_codes");
  });

  it("single-method reset touches only that method and its own pending challenges", async () => {
    seedEnrollments(["totp", "sms"], 0);

    const { clearedMethods } = await mfa.resetMfaForUser(42, { method: "totp" });

    expect(clearedMethods).toEqual(["totp"]);
    expect(deletedTables()).toEqual(["mfa_enrollments", "mfa_challenges"]);
    // Crucially NOT the bypass codes: a targeted un-enrollment is not a full reset.
    expect(deletedTables()).not.toContain("mfa_bypass_codes");
    expect(deleteFor("mfa_challenges")?.where).toMatchObject({
      c: [expect.anything(), { op: "eq", a: "mfa_challenges.method", b: "totp" }],
    });
  });

  it("single-method passkey reset clears webauthn challenges, not the generic mfa_challenges table", async () => {
    seedEnrollments([], 1);

    const { clearedMethods } = await mfa.resetMfaForUser(42, { method: "passkey" });

    expect(clearedMethods).toEqual(["passkey"]);
    expect(deletedTables()).toEqual(["webauthn_credentials", "mfa_enrollments", "webauthn_challenges"]);
  });

  it("reports nothing cleared when the requested method was not enrolled", async () => {
    seedEnrollments(["totp"], 0);

    const { clearedMethods } = await mfa.resetMfaForUser(42, { method: "sms" });

    expect(clearedMethods).toEqual([]);
  });
});

describe("adminResetMfa", () => {
  const TARGET = { id: 42, email: "jane@contoso.test", name: "Jane Doe" };

  it("resets, notifies the account, and audit-logs actor + target + methods", async () => {
    selectQueue.push([TARGET]); // target lookup
    seedEnrollments(["totp"], 1);

    const result = await mfa.adminResetMfa({
      userId: 42,
      actor: { id: ACTOR_ID, email: "admin@shanemccaw.consulting", name: "Platform Admin" },
      source: "admin.active-directory",
    });

    expect(result).toMatchObject({ clearedMethods: ["totp", "passkey"], targetEmail: TARGET.email });
    expect(mockSendEmailFromTemplate).toHaveBeenCalledWith(
      "mfa-reset",
      TARGET.email,
      expect.objectContaining({ methodsList: "Authenticator App (TOTP), Passkey / Security Key" }),
      expect.any(String),
      expect.any(String),
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        actorRole: "admin",
        actionType: "admin_mfa_reset",
        entityType: "user",
        entityId: 42,
        metadata: expect.objectContaining({ clearedMethods: ["totp", "passkey"], method: "all", source: "admin.active-directory" }),
      }),
    );
  });

  it("returns null for an unknown account without deleting anything", async () => {
    selectQueue.push([]); // no target row

    const result = await mfa.adminResetMfa({
      userId: 999,
      actor: { id: ACTOR_ID, email: "admin@shanemccaw.consulting" },
      source: "admin.active-directory",
    });

    expect(result).toBeNull();
    expect(deletes).toHaveLength(0);
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("still completes the reset when the notification e-mail fails", async () => {
    selectQueue.push([TARGET]);
    seedEnrollments(["sms"], 0);
    mockSendEmailFromTemplate.mockRejectedValueOnce(new Error("smtp down"));

    const result = await mfa.adminResetMfa({
      userId: 42,
      actor: { id: ACTOR_ID, email: "admin@shanemccaw.consulting" },
      source: "auth.mfa.admin-reset",
    });

    expect(result?.clearedMethods).toEqual(["sms"]);
    expect(deletedTables()).toContain("mfa_bypass_codes");
  });
});

describe("POST /auth/mfa/admin/reset/:userId — the admin-gated route", () => {
  it("rejects a non-admin caller before any delete", async () => {
    const res = await request(app).post("/auth/mfa/admin/reset/42").send({});

    expect(res.status).toBe(401);
    expect(deletes).toHaveLength(0);
  });

  it("resets all methods for an admin caller", async () => {
    selectQueue.push([{ id: 42, email: "jane@contoso.test", name: "Jane Doe" }]);
    seedEnrollments(["totp"], 0);

    const res = await request(app).post("/auth/mfa/admin/reset/42").set(authHeader).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, clearedMethods: ["totp"] });
  });

  it("400s an unrecognised method and deletes nothing", async () => {
    const res = await request(app).post("/auth/mfa/admin/reset/42").set(authHeader).send({ method: "smoke-signal" });

    expect(res.status).toBe(400);
    expect(deletes).toHaveLength(0);
  });

  it("404s an unknown account", async () => {
    selectQueue.push([]);

    const res = await request(app).post("/auth/mfa/admin/reset/999").set(authHeader).send({});

    expect(res.status).toBe(404);
  });
});
