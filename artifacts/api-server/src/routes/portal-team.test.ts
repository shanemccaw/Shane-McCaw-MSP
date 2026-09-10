import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Top level variables prefixed with 'mock' to bypass hoisting checks.
// mockSelectResults is consumed in FIFO order by successive db.select() chains,
// falling back to [] once exhausted.
let mockSelectResultsQueue: any[][] = [];
let mockDefaultSelectResult: any[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) => {
        const result = mockSelectResultsQueue.length > 0
          ? mockSelectResultsQueue.shift()!
          : mockDefaultSelectResult;
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return chain;
  };

  const makeDeleteChain = () => {
    const chain: any = {
      where: () => chain,
      then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
    };
    return chain;
  };

  const updateChain: any = {
    set: () => updateChain,
    where: () => updateChain,
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const insertChain: any = {
    values: () => insertChain,
    returning: () => Promise.resolve([]),
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    delete: vi.fn().mockImplementation(() => makeDeleteChain()),
    update: vi.fn().mockImplementation(() => updateChain),
    insert: vi.fn().mockImplementation(() => insertChain),
  };

  const table = (name: string) => ({ __table: name });

  // Trimmed to exactly what portal-team.ts imports directly from @workspace/db,
  // plus a couple of tables that are ONLY needed so modules portal-team.ts pulls
  // in transitively (../middlewares/requireAuth.ts's tenantsTable/
  // mspStaffCustomerScopesTable, ../lib/session-tracking.ts's
  // mspRefreshTokensTable) resolve to a defined (if unused-by-this-test) value
  // rather than the full portal.ts table list this mock originally carried.
  return {
    db: mockDb,
    usersTable: { id: "id", email: "email", role: "role", name: "name", tenantId: "tenant_id", mspId: "msp_id", mspRole: "msp_role" },
    mfaEnrollmentsTable: table("mfaEnrollments"),
    webauthnCredentialsTable: table("webauthnCredentials"),
    userSessionsTable: table("userSessions"),
    passwordResetTokensTable: table("passwordResetTokens"),
    mfaChallengesTable: table("mfaChallenges"),
    webauthnChallengesTable: table("webauthnChallenges"),
    mfaBypassCodesTable: table("mfaBypassCodes"),
    tenantsTable: { id: "id", mspId: "msp_id" },
    mspStaffCustomerScopesTable: table("mspStaffCustomerScopes"),
    mspRefreshTokensTable: table("mspRefreshTokens"),
  };
});

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/session-tracking.ts", () => ({
  revokeAllOtherSessions: vi.fn().mockResolvedValue(0),
}));

vi.mock("../lib/portal-url.ts", () => ({
  getPortalBaseUrl: vi.fn().mockReturnValue("https://portal.test"),
  getMspPortalBaseUrl: vi.fn().mockReturnValue("https://portal.test/portal"),
  buildAccountSetupUrl: vi.fn().mockReturnValue("https://portal.test/setup"),
}));

vi.mock("../lib/mailer.ts", () => ({
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  passwordResetEmail: vi.fn(),
}));

vi.mock("../lib/client-setup-token.ts", () => ({
  ensureClientSetupToken: vi.fn().mockResolvedValue({ token: "setup-token", isNew: true }),
}));

// portal-team.ts does `const log = logger.child(...)` at module scope.
vi.mock("../lib/logger.ts", () => {
  const child = vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child,
  }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

// #3360 — lets a suite open gate 1 (tenant isolation) so gate 2 (customer:team.manage)
// can be proven to hold ON ITS OWN. Defaults to the real function, so every other
// test in this file sees the real assertCustomerAccess.
const mockGate1 = vi.hoisted(() => ({ forceAllow: false }));
vi.mock("../middlewares/requireAuth.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/requireAuth.ts")>();
  return {
    ...actual,
    assertCustomerAccess: vi.fn((user: Parameters<typeof actual.assertCustomerAccess>[0], customerId: number) =>
      mockGate1.forceAllow ? Promise.resolve(true) : actual.assertCustomerAccess(user, customerId)),
  };
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "@workspace/db";
import { CAPABILITY_COLUMN_ROLE_KEYS } from "@workspace/db/rbac/legacy-ladder";
import router from "./portal-team.ts";
import { sendEmailFromTemplate } from "../lib/mailer.ts";
import { revokeAllOtherSessions } from "../lib/session-tracking.ts";
import { setGrantRole } from "../middlewares/rbac-capability.ts";

const sendEmailFromTemplateMock = vi.mocked(sendEmailFromTemplate);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  // Minimal req.log stub — real requests get this from pino-http; requireAuth
  // calls req.log.child(...) when present.
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
// portal-team.ts's own routes already carry the literal "/portal/team/..."
// prefix, so mounting at "/api" (the standard house-style mount, NOT the
// doubled "/api/portal" the old portal.ts test file used) hits the real
// "/api/portal/team/:userId/reset-mfa" path.
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeAdminToken(): string {
  return jwt.sign({ id: 99, email: "admin@shanemccaw.com", role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
}

// #172: mailer.ts's PORTAL_URL hardcoded /crm/portal hybrid was removed;
// portal-team.ts's own MFA-reset link builder must resolve exclusively off
// getMspPortalBaseUrl(), never a leftover /crm path.
describe("POST /api/portal/team/:userId/reset-mfa (#172)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("builds every generated link off getMspPortalBaseUrl(), never the retired /crm path", async () => {
    const targetUserId = 55;
    const token = makeAdminToken();

    mockSelectResultsQueue = [
      [{ customerId: 1, email: "teammate@example.com", name: "Teammate" }], // target lookup
      [{ method: "totp" }], // mfa enrollments
      [], // passkey rows
    ];

    const res = await request(app)
      .post(`/api/portal/team/${targetUserId}/reset-mfa`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(sendEmailFromTemplateMock).toHaveBeenCalledTimes(1);
    const [, , mergeFields, , bodyHtml] = sendEmailFromTemplateMock.mock.calls[0];
    expect(mergeFields.loginLink).not.toContain("/crm");
    expect(mergeFields.securityLink).not.toContain("/crm");
    expect(bodyHtml).not.toContain("/crm");
  });
});

// #3360 — the team-admin gate must fail CLOSED on a caller whose mspRole claim names
// no recognised role. Before #2460 it tested `isCustomerTier` and took the permitted
// branch for anything else; only gate 1 in front of it kept that unreachable. These
// run with gate 1 forced open, so gate 2 is proven to hold by itself.
describe("#3360 — denyIfCannotManageTeam denies an unrecognised role even with tenant isolation passed", () => {
  const MUTATING_ROUTES = [
    { method: "delete", path: "/api/portal/team/55/sessions" },
    { method: "post", path: "/api/portal/team/invite", body: { email: "new-teammate@example.com" } },
    { method: "patch", path: "/api/portal/team/55/status", body: { isActive: false } },
    { method: "patch", path: "/api/portal/team/55/manager", body: { managerUserId: null } },
    { method: "patch", path: "/api/portal/team/55/mfa-enforcement", body: { enforced: false } },
    { method: "post", path: "/api/portal/team/55/unlock" },
    { method: "post", path: "/api/portal/team/55/reset-password" },
    { method: "post", path: "/api/portal/team/55/temp-password" },
    { method: "post", path: "/api/portal/team/55/reset-mfa" },
    { method: "post", path: "/api/portal/team/55/emergency-bypass" },
  ] as const;
  type Route = (typeof MUTATING_ROUTES)[number];
  const unlock = MUTATING_ROUTES.find((r) => r.path.endsWith("/unlock"))!;

  function clientToken(id: number, mspRole: unknown): string {
    const claims: Record<string, unknown> = { id, email: `caller${id}@example.com`, role: "client", mspId: 1, customerId: 1 };
    if (mspRole !== undefined) claims.mspRole = mspRole;
    return jwt.sign(claims, JWT_SECRET, { expiresIn: "1h" });
  }

  function send(route: Route, token: string) {
    const req = (request(app) as any)[route.method](route.path).set("Authorization", `Bearer ${token}`);
    return "body" in route ? req.send(route.body) : req;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGate1.forceAllow = true;
    mockSelectResultsQueue = [];
    // Every target lookup finds a member of tenant 1 — the caller's own tenant.
    mockDefaultSelectResult = [{ customerId: 1, email: "teammate@example.com", name: "Teammate" }];
  });

  afterEach(() => {
    mockGate1.forceAllow = false;
  });

  it("covers every route that calls the gate", () => {
    const source = readFileSync(fileURLToPath(new URL("./portal-team.ts", import.meta.url)), "utf8");
    const gated = source.match(/await denyIfCannotManageTeam\(req\.user!/g) ?? [];
    expect(gated.length).toBe(MUTATING_ROUTES.length);
  });

  for (const [label, claim] of [
    ["absent", undefined],
    ["null", null],
    ["an unknown name", "NotARole"],
    ["a case-variant of a real rung", "mspadmin"],
  ] as const) {
    it(`answers 403 on all ${MUTATING_ROUTES.length} routes and writes nothing when the claim is ${label}`, async () => {
      const token = clientToken(501, claim);
      for (const route of MUTATING_ROUTES) {
        const res = await send(route, token);
        expect(res.status, `${route.method.toUpperCase()} ${route.path}`).toBe(403);
      }
      expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
      expect(vi.mocked(db.update)).not.toHaveBeenCalled();
      expect(vi.mocked(db.delete)).not.toHaveBeenCalled();
      expect(vi.mocked(revokeAllOtherSessions)).not.toHaveBeenCalled();
      expect(sendEmailFromTemplateMock).not.toHaveBeenCalled();
    });
  }

  it("lets the same caller through once they hold the cap.team.manage grant — so the 403s above are gate 2", async () => {
    const id = 502;
    expect(await setGrantRole("customer", id, CAPABILITY_COLUMN_ROLE_KEYS.manageTeam, true, null)).toEqual({ ok: true });
    const res = await send(unlock, clientToken(id, "NotARole"));
    expect(res.status).toBe(200);
  });

  it("still refuses that granted caller at gate 1 when tenant isolation is real — both layers hold independently", async () => {
    const id = 503;
    expect(await setGrantRole("customer", id, CAPABILITY_COLUMN_ROLE_KEYS.manageTeam, true, null)).toEqual({ ok: true });
    mockGate1.forceAllow = false;
    const res = await send(unlock, clientToken(id, "NotARole"));
    expect(res.status).toBe(403);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });
});
