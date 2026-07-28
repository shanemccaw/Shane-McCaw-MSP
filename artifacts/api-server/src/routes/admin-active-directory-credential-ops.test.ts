/**
 * admin-active-directory-credential-ops.test.ts
 *
 * Active Directory Phase 8 (Issue #68) — the three security-sensitive User
 * Object write endpoints:
 *
 *   POST /admin/active-directory/user/:id/force-password-reset
 *   POST /admin/active-directory/user/:id/mfa-reset
 *   POST /admin/active-directory/user/:id/impersonate
 *
 * The point of these tests is not just "the route returns 200" — it is that
 * each one is a thin entry point onto a mechanism that already existed, which
 * is the whole premise of the phase:
 *
 *   • the forced reset invalidates sessions through the codebase's established
 *     convention, revokeAllOtherSessions(userId, null) (lib/session-tracking.ts),
 *     and issues the SAME passwordResetTokensTable/e-mail flow as
 *     /auth/forgot-password — falling back to the account-setup token for an
 *     account that never had a password, exactly as that route does;
 *   • the MFA reset delegates to mfa.ts's adminResetMfa() rather than
 *     re-implementing un-enrollment;
 *   • impersonation writes an impersonation_tokens row for the pre-existing
 *     POST /auth/impersonate-exchange to consume — no second mechanism.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";

const ADMIN_PASS = "test-admin-pass";
const ACTOR_ID = 1;
const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

// ── Table identities: every mocked table is a tagged object so insert() calls
// can be attributed to the right table without a real schema.
function table(name: string) {
  return { __table: name } as Record<string, unknown>;
}

const {
  selectQueue,
  inserts,
  mockRevokeAllOtherSessions,
  mockCreateAuditLog,
  mockAdminResetMfa,
  mockSendEmailFromTemplate,
} = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  mockRevokeAllOtherSessions: vi.fn(),
  mockCreateAuditLog: vi.fn(),
  mockAdminResetMfa: vi.fn(),
  mockSendEmailFromTemplate: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  // Every drizzle builder method returns the same thenable chain; awaiting it
  // shifts the next canned result off selectQueue.
  function chain(): Record<string, unknown> {
    const self: Record<string, unknown> = {};
    for (const method of ["from", "where", "limit", "innerJoin", "leftJoin", "orderBy", "groupBy"]) {
      self[method] = () => self;
    }
    self.then = (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []);
    return self;
  }

  return {
    db: {
      select: vi.fn(() => chain()),
      insert: vi.fn((t: { __table: string }) => ({
        values: vi.fn(async (values: Record<string, unknown>) => {
          inserts.push({ table: t.__table, values });
        }),
      })),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
      delete: vi.fn(() => ({ where: async () => undefined })),
    },
    mspsTable: table("msps"),
    mspCustomersTable: table("msp_customers"),
    mspUsersTable: table("msp_users"),
    usersTable: table("users"),
    mspSubscriptionsTable: table("msp_subscriptions"),
    servicesTable: table("services"),
    platformAgreementsTable: table("platform_agreements"),
    mspAgreementAcceptancesTable: table("msp_agreement_acceptances"),
    tenantConsentTable: table("tenant_consent"),
    tenantSharePointConsentTable: table("tenant_sharepoint_consent"),
    tenantWriteConsentTable: table("tenant_write_consent"),
    clientServicesTable: table("client_services"),
    mspDiagnosticRunsTable: table("msp_diagnostic_runs"),
    activeDirectoryOusTable: table("active_directory_ous"),
    userSessionsTable: table("user_sessions"),
    mfaEnrollmentsTable: table("mfa_enrollments"),
    passwordResetTokensTable: table("password_reset_tokens"),
    accountSetupTokensTable: table("account_setup_tokens"),
    impersonationTokensTable: table("impersonation_tokens"),
    mspAuditLogsTable: table("msp_audit_logs"),
    userEntitlementOverridesTable: table("user_entitlement_overrides"),
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] !== `Bearer ${ADMIN_PASS}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = {
      id: ACTOR_ID,
      email: "admin@shanemccaw.consulting",
      name: "Platform Admin",
      role: "admin",
      mspRole: "PlatformAdmin",
    };
    next();
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("../lib/session-tracking", () => ({ revokeAllOtherSessions: mockRevokeAllOtherSessions }));
vi.mock("../lib/audit", () => ({ createAuditLog: mockCreateAuditLog }));
vi.mock("../lib/mailer.ts", () => ({
  sendEmailFromTemplate: mockSendEmailFromTemplate,
  passwordResetEmail: ({ resetUrl }: { resetUrl: string }) => `<a href="${resetUrl}">reset</a>`,
  PORTAL_URL: "https://example.test/portal",
}));
vi.mock("../lib/portal-url.ts", () => ({
  getMspPortalBaseUrl: () => "https://example.test/portal",
  buildAccountSetupUrl: (token: string) => `https://example.test/portal/account-setup?setup_token=${token}`,
}));
vi.mock("../lib/request-context.ts", () => ({ getRequestContext: () => ({ traceId: "trace-1" }) }));
vi.mock("../lib/tenant-signals", () => ({ resolveCustomerUserIds: vi.fn().mockResolvedValue([]) }));

// The mfa-reset route MUST go through mfa.ts rather than owning a second
// un-enrollment implementation, so the module is mocked and the delegation is
// asserted directly.
vi.mock("./mfa", () => ({
  adminResetMfa: mockAdminResetMfa,
  isMfaMethod: (v: unknown) => typeof v === "string" && ["totp", "sms", "passkey"].includes(v),
  MFA_METHODS: ["totp", "sms", "passkey"] as const,
}));

// active-directory.ts is pure helper code — pass it through untouched so this
// suite does not have to track which helpers each phase adds to it.
vi.mock("../lib/active-directory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));

const TARGET_WITH_PASSWORD = {
  id: 42,
  email: "jane@contoso.test",
  name: "Jane Doe",
  passwordHash: "$2a$12$hashhashhash",
};
const TARGET_WITHOUT_PASSWORD = { id: 43, email: "new@contoso.test", name: null, passwordHash: null };

let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  inserts.length = 0;
  mockRevokeAllOtherSessions.mockResolvedValue(3);
  mockCreateAuditLog.mockResolvedValue(undefined);
  mockSendEmailFromTemplate.mockResolvedValue(undefined);

  app = express();
  app.use(express.json());
  const { default: router } = await import("./admin-active-directory");
  app.use(router);
});

function insertsTo(name: string) {
  return inserts.filter((i) => i.table === name);
}

// ─── force-password-reset ────────────────────────────────────────────────────

describe("POST /admin/active-directory/user/:id/force-password-reset", () => {
  it("rejects an unauthenticated caller before touching anything", async () => {
    const res = await request(app).post("/admin/active-directory/user/42/force-password-reset");

    expect(res.status).toBe(401);
    expect(mockRevokeAllOtherSessions).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("400s on a non-numeric user id without querying", async () => {
    const res = await request(app).post("/admin/active-directory/user/abc/force-password-reset").set(authHeader);

    expect(res.status).toBe(400);
    expect(mockRevokeAllOtherSessions).not.toHaveBeenCalled();
  });

  it("404s for an unknown account and invalidates nothing", async () => {
    selectQueue.push([]); // loadTargetAccount → no row

    const res = await request(app).post("/admin/active-directory/user/999/force-password-reset").set(authHeader);

    expect(res.status).toBe(404);
    expect(mockRevokeAllOtherSessions).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("issues a reset token, e-mails the link, and invalidates EVERY session via the established convention", async () => {
    selectQueue.push([TARGET_WITH_PASSWORD]);

    const res = await request(app).post("/admin/active-directory/user/42/force-password-reset").set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, flow: "password_reset", revokedSessionCount: 3 });

    // The invalidation convention: revokeAllOtherSessions(userId, null) — the
    // documented "revoke ALL of this user's sessions" form, not a bespoke query.
    expect(mockRevokeAllOtherSessions).toHaveBeenCalledWith(42, null);

    const tokenRows = insertsTo("password_reset_tokens");
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0].values.userId).toBe(42);
    expect(String(tokenRows[0].values.token)).toMatch(/^[0-9a-f]{64}$/);
    expect((tokenRows[0].values.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    // A forced reset must never quietly create an account-setup token instead.
    expect(insertsTo("account_setup_tokens")).toHaveLength(0);

    expect(mockSendEmailFromTemplate).toHaveBeenCalledWith(
      "password-reset",
      TARGET_WITH_PASSWORD.email,
      expect.objectContaining({ resetLink: expect.stringContaining("/reset-password?token=") }),
      expect.any(String),
      expect.any(String),
    );
  });

  it("audit-logs the reset with actor identity, target account, and outcome", async () => {
    selectQueue.push([TARGET_WITH_PASSWORD]);

    await request(app).post("/admin/active-directory/user/42/force-password-reset").set(authHeader);

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        actorRole: "admin",
        actionType: "admin_forced_password_reset",
        entityType: "user",
        entityId: 42,
        entityLabel: "Jane Doe",
        metadata: expect.objectContaining({ flow: "password_reset", revokedSessionCount: 3 }),
      }),
    );
  });

  it("falls back to the account-setup flow for an account that never had a password", async () => {
    selectQueue.push([TARGET_WITHOUT_PASSWORD]);

    const res = await request(app).post("/admin/active-directory/user/43/force-password-reset").set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.flow).toBe("account_setup");
    // Sessions are still invalidated — the account state only changes which
    // link the target receives, never whether they keep their live sessions.
    expect(mockRevokeAllOtherSessions).toHaveBeenCalledWith(43, null);
    expect(insertsTo("account_setup_tokens")).toHaveLength(1);
    expect(insertsTo("password_reset_tokens")).toHaveLength(0);
    expect(mockSendEmailFromTemplate).toHaveBeenCalledWith(
      "account-setup",
      TARGET_WITHOUT_PASSWORD.email,
      expect.objectContaining({ setupLink: expect.stringContaining("setup_token=") }),
      expect.any(String),
      expect.any(String),
    );
  });

  it("still invalidates sessions when the notification e-mail transport fails", async () => {
    selectQueue.push([TARGET_WITH_PASSWORD]);
    mockSendEmailFromTemplate.mockRejectedValueOnce(new Error("smtp down"));

    const res = await request(app).post("/admin/active-directory/user/42/force-password-reset").set(authHeader);

    expect(res.status).toBe(200);
    expect(mockRevokeAllOtherSessions).toHaveBeenCalledWith(42, null);
    expect(insertsTo("password_reset_tokens")).toHaveLength(1);
  });
});

// ─── mfa-reset ───────────────────────────────────────────────────────────────

describe("POST /admin/active-directory/user/:id/mfa-reset", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).post("/admin/active-directory/user/42/mfa-reset");

    expect(res.status).toBe(401);
    expect(mockAdminResetMfa).not.toHaveBeenCalled();
  });

  it("delegates to mfa.ts's adminResetMfa rather than re-implementing un-enrollment", async () => {
    mockAdminResetMfa.mockResolvedValue({
      clearedMethods: ["totp", "passkey"],
      targetEmail: TARGET_WITH_PASSWORD.email,
      targetName: TARGET_WITH_PASSWORD.name,
    });

    const res = await request(app).post("/admin/active-directory/user/42/mfa-reset").set(authHeader).send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, clearedMethods: ["totp", "passkey"] });
    expect(mockAdminResetMfa).toHaveBeenCalledTimes(1);
    expect(mockAdminResetMfa).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        method: undefined,
        actor: expect.objectContaining({ id: ACTOR_ID }),
        source: "admin.active-directory",
      }),
    );
  });

  it("passes a single method through for a per-method un-enrollment", async () => {
    mockAdminResetMfa.mockResolvedValue({ clearedMethods: ["sms"], targetEmail: "x@y.test", targetName: null });

    const res = await request(app).post("/admin/active-directory/user/42/mfa-reset").set(authHeader).send({ method: "sms" });

    expect(res.status).toBe(200);
    expect(mockAdminResetMfa).toHaveBeenCalledWith(expect.objectContaining({ method: "sms" }));
  });

  it("400s an unrecognised method and never calls the reset", async () => {
    const res = await request(app)
      .post("/admin/active-directory/user/42/mfa-reset")
      .set(authHeader)
      .send({ method: "carrier-pigeon" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/totp/);
    expect(mockAdminResetMfa).not.toHaveBeenCalled();
  });

  it("404s when the target account does not exist", async () => {
    mockAdminResetMfa.mockResolvedValue(null);

    const res = await request(app).post("/admin/active-directory/user/999/mfa-reset").set(authHeader).send({});

    expect(res.status).toBe(404);
  });
});

// ─── impersonate ─────────────────────────────────────────────────────────────

describe("POST /admin/active-directory/user/:id/impersonate", () => {
  it("rejects an unauthenticated caller before issuing a token", async () => {
    const res = await request(app).post("/admin/active-directory/user/42/impersonate");

    expect(res.status).toBe(401);
    expect(insertsTo("impersonation_tokens")).toHaveLength(0);
  });

  it("issues a single-use 30-minute token for the pre-existing exchange endpoint, with the target's tenant slug", async () => {
    selectQueue.push([TARGET_WITH_PASSWORD]); // loadTargetAccount
    selectQueue.push([{ mspId: 7, customerId: 12, mspRole: "CustomerUser", isActive: true }]); // linkage
    selectQueue.push([{ slug: "contoso", name: "Contoso IT" }]); // owning MSP

    const before = Date.now();
    const res = await request(app).post("/admin/active-directory/user/42/impersonate").set(authHeader);

    expect(res.status).toBe(200);
    expect(String(res.body.token)).toMatch(/^[0-9a-f]{64}$/);
    // msp-portal's auth-context needs target_slug alongside the token to land
    // the new tab on the right tenant — without it it can only warn and stay put.
    expect(res.body.targetSlug).toBe("contoso");
    expect(res.body.user).toMatchObject({ id: 42, email: TARGET_WITH_PASSWORD.email, mspRole: "CustomerUser" });

    const tokenRows = insertsTo("impersonation_tokens");
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0].values).toMatchObject({ clientUserId: 42, adminUserId: ACTOR_ID });
    const expiresAt = tokenRows[0].values.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(before + 29 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
  });

  it("audit-logs the session start with actor, target, and timestamp", async () => {
    selectQueue.push([TARGET_WITH_PASSWORD]);
    selectQueue.push([{ mspId: 7, customerId: 12, mspRole: "CustomerUser", isActive: true }]);
    selectQueue.push([{ slug: "contoso", name: "Contoso IT" }]);

    await request(app).post("/admin/active-directory/user/42/impersonate").set(authHeader);

    const mspAudit = insertsTo("msp_audit_logs");
    expect(mspAudit).toHaveLength(1);
    expect(mspAudit[0].values).toMatchObject({
      actorUserId: ACTOR_ID,
      actionType: "IMPERSONATION_TOKEN_ISSUED",
      entityType: "user",
      entityId: "42",
      mspId: 7,
      customerId: 12,
      outcome: "success",
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        actionType: "admin_impersonation_started",
        entityId: 42,
        entityLabel: "Jane Doe",
        metadata: expect.objectContaining({ targetSlug: "contoso", expiresAt: expect.any(String) }),
      }),
    );
  });

  it("refuses to impersonate another PlatformAdmin — that is lateral admin access, not preview", async () => {
    selectQueue.push([{ ...TARGET_WITH_PASSWORD, id: 99 }]);
    selectQueue.push([{ mspId: null, customerId: null, mspRole: "PlatformAdmin", isActive: true }]);

    const res = await request(app).post("/admin/active-directory/user/99/impersonate").set(authHeader);

    expect(res.status).toBe(403);
    expect(insertsTo("impersonation_tokens")).toHaveLength(0);
  });

  it("refuses self-impersonation before any lookup", async () => {
    const res = await request(app).post(`/admin/active-directory/user/${ACTOR_ID}/impersonate`).set(authHeader);

    expect(res.status).toBe(400);
    expect(insertsTo("impersonation_tokens")).toHaveLength(0);
  });

  it("404s for an unknown account and issues no token", async () => {
    selectQueue.push([]);

    const res = await request(app).post("/admin/active-directory/user/999/impersonate").set(authHeader);

    expect(res.status).toBe(404);
    expect(insertsTo("impersonation_tokens")).toHaveLength(0);
  });

  it("still issues a token for an account with no owning MSP, reporting a null slug rather than guessing one", async () => {
    selectQueue.push([TARGET_WITH_PASSWORD]);
    selectQueue.push([{ mspId: null, customerId: null, mspRole: "CustomerUser", isActive: true }]);

    const res = await request(app).post("/admin/active-directory/user/42/impersonate").set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.targetSlug).toBeNull();
    expect(insertsTo("impersonation_tokens")).toHaveLength(1);
  });
});
