import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * HTTP-level tests for Active Directory Phase 9 (Issue #69): the
 * dev-environment-only cascading hard delete,
 * DELETE /admin/active-directory/user/:id. Proves the three acceptance-
 * criteria behaviors:
 *
 *  (a) the non-production gate blocks the route in a prod-like config
 *      (NODE_ENV=production AND — fail closed — NODE_ENV unset), before
 *      any transaction is opened;
 *  (b) a successful delete issues explicit deletes against EVERY table in
 *      the route's audited explicit-delete list, in dependency-safe order,
 *      with the users row last — and issues NO delete against the tables
 *      the DB auto-handles (onDelete cascade/set-null), which is the
 *      route's contract with the schema;
 *  (c) a failure partway through rejects the whole transaction (rollback)
 *      — 500, no users delete issued, no post-commit audit row written.
 *
 * Plus: the FULL pre-delete state is logged to the `audit` channel BEFORE
 * the transaction commits (asserted by capturing tx commit state at the
 * moment of the logger call).
 *
 * Mocks @workspace/db with the same queueable chain as
 * admin-active-directory-user-actions.test.ts, extended with a
 * db.transaction wrapper that tracks committed/rolled-back state and an
 * operation record of every select/delete and which table it targeted.
 */

const h = vi.hoisted(() => {
  const txState = { committed: false, rolledBack: false };
  /** Every db operation in call order: { op, table } (table = $tableName). */
  const opRecords: Array<{ op: "select" | "insert" | "update" | "delete"; table: string | null }> = [];
  /** Queued results, shifted per terminal await. An Error entry rejects. */
  const queue: unknown[] = [];
  const auditInfoCalls: Array<{ payload: Record<string, unknown>; msg: string; committedAtCall: boolean }> = [];
  const auditWarnCalls: Array<{ payload: Record<string, unknown>; msg: string }> = [];
  return { txState, opRecords, queue, auditInfoCalls, auditWarnCalls };
});

const auditLogSpy = vi.fn();

vi.mock("../lib/audit", () => ({
  createAuditLog: (...args: unknown[]) => {
    auditLogSpy(...args);
    return Promise.resolve();
  },
}));

vi.mock("../lib/logger", () => {
  function channelLogger(channel: string): Record<string, unknown> {
    return {
      info: (payload: Record<string, unknown>, msg: string) => {
        if (channel === "audit") h.auditInfoCalls.push({ payload, msg, committedAtCall: h.txState.committed });
      },
      warn: (payload: Record<string, unknown>, msg: string) => {
        if (channel === "audit") h.auditWarnCalls.push({ payload, msg });
      },
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      child: (opts?: { channel?: string }) => channelLogger(opts?.channel ?? channel),
    };
  }
  return { logger: channelLogger("") };
});

vi.mock("@workspace/db", () => {
  function makeChain(op: "select" | "insert" | "update" | "delete") {
    const record: { op: "select" | "insert" | "update" | "delete"; table: string | null } = { op, table: null };
    h.opRecords.push(record);
    const chain: any = {
      from: (t: any) => {
        record.table = t?.$tableName ?? null;
        return chain;
      },
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      set: () => chain,
      values: () => chain,
      onConflictDoUpdate: () => Promise.resolve(h.queue.shift() ?? []),
      returning: () => Promise.resolve(h.queue.shift() ?? []),
      then: (onFulfilled: any, onRejected: any) => {
        const next = h.queue.shift();
        if (next instanceof Error) return Promise.reject(next).then(onFulfilled, onRejected);
        return Promise.resolve(next ?? []).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  const mockDb: any = {
    select: vi.fn(() => makeChain("select")),
    insert: vi.fn(() => makeChain("insert")),
    update: vi.fn(() => makeChain("update")),
    delete: vi.fn((t: any) => {
      const chain = makeChain("delete");
      h.opRecords[h.opRecords.length - 1]!.table = t?.$tableName ?? null;
      return chain;
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      h.txState.committed = false;
      h.txState.rolledBack = false;
      try {
        const out = await fn(mockDb);
        h.txState.committed = true;
        return out;
      } catch (err) {
        h.txState.rolledBack = true;
        throw err;
      }
    }),
  };

  const tbl = (name: string, cols: string[]) =>
    Object.assign(Object.fromEntries(cols.map((c) => [c, c])), { $tableName: name });

  return {
    db: mockDb,
    // Tables the Phase 1-8 routes reference (only what module import needs).
    mspsTable: tbl("msps", ["id", "name", "slug"]),
    tenantsTable: tbl("tenants", ["id", "mspId", "customerName", "tenantId", "consent", "status"]),
    usersTable: tbl("users", ["id", "email", "name", "role", "mspId", "tenantId", "mspRole", "isActive", "mfaEnforced"]),
    mspSubscriptionsTable: tbl("msp_subscriptions", ["mspId", "serviceId", "status"]),
    servicesTable: tbl("services", ["id", "name", "typeAttributes"]),
    platformAgreementsTable: tbl("platform_agreements", ["version", "isCurrentVersion"]),
    activeDirectoryOusTable: tbl("active_directory_ous", ["id", "name", "createdAt", "updatedAt"]),
    mspAuditLogsTable: tbl("msp_audit_logs", ["actorUserId", "actionType"]),
    accountSetupTokensTable: tbl("account_setup_tokens", ["userId", "token", "expiresAt"]),
    // ── Phase 9 explicit-delete footprint ─────────────────────────────────
    projectsTable: tbl("projects", ["id", "clientUserId", "signedOffBy"]),
    workflowStepsTable: tbl("workflow_steps", ["id", "projectId", "clientServiceId"]),
    kanbanTasksTable: tbl("kanban_tasks", ["id", "projectId"]),
    clientServicesTable: tbl("client_services", ["id", "clientUserId", "projectId", "serviceId", "status", "billingInterval", "purchasedAt"]),
    documentsTable: tbl("documents", ["id", "projectId", "uploadedBy"]),
    reportsTable: tbl("reports", ["id", "clientUserId", "projectId"]),
    invoicesTable: tbl("invoices", ["id", "clientUserId", "projectId"]),
    messagesTable: tbl("messages", ["id", "clientUserId", "senderUserId"]),
    notificationsTable: tbl("notifications", ["id", "userId"]),
    projectUpdatesTable: tbl("project_updates", ["id", "projectId", "authorUserId"]),
    contractsTable: tbl("contracts", ["id", "userId", "projectId"]),
    statusReportsTable: tbl("status_reports", ["id", "clientUserId", "projectId"]),
    emailsTable: tbl("emails", ["id", "linkedUserId"]),
    emailDomainRulesTable: tbl("email_domain_rules", ["id", "linkedUserId"]),
    clientDocumentsTable: tbl("client_documents", ["id", "clientUserId", "uploadedBy"]),
    passwordResetTokensTable: tbl("password_reset_tokens", ["id", "userId", "token", "expiresAt"]),
    impersonationTokensTable: tbl("impersonation_tokens", ["id", "clientUserId", "adminUserId", "token", "expiresAt"]),
    mfaEnrollmentsTable: tbl("mfa_enrollments", ["id", "userId", "method", "enabled", "createdAt"]),
    mfaChallengesTable: tbl("mfa_challenges", ["id", "userId"]),
    mfaBypassCodesTable: tbl("mfa_bypass_codes", ["id", "userId", "createdByUserId"]),
    userSessionsTable: tbl("user_sessions", ["id", "userId", "sessionType"]),
    userEntitlementOverridesTable: tbl("user_entitlement_overrides", ["id", "userId", "capabilityKey", "enabled", "grantedByUserId", "createdAt", "updatedAt"]),
    consentInviteTokensTable: tbl("consent_invite_tokens", ["token", "tenantId", "customerId", "clientUserId"]),
    insightsGeneratedDocumentsTable: tbl("insights_generated_documents", ["id", "customerId", "mspCustomerId"]),
    tenantMonitorProfilesTable: tbl("tenant_monitor_profiles", ["id", "tenantId"]),
    mspDiagnosticRunsTable: tbl("msp_diagnostic_runs", ["id", "runId", "customerId", "tenantId", "triggeredByUserId", "packageKey", "status", "startedAt", "completedAt", "createdAt"]),
    mspDiagnosticFindingsTable: tbl("msp_diagnostic_findings", ["id", "runId", "customerId"]),
    mspCustomerClickwrapsTable: tbl("msp_customer_clickwraps", ["id", "customerId", "customerUserId"]),
    mspAgreementAcceptancesTable: tbl("msp_agreement_acceptances", ["id", "mspId", "userId", "agreementVersion", "acceptedAt", "checkboxConfirmed"]),
    mspImpersonationTokensTable: tbl("msp_impersonation_tokens", ["id", "actorUserId", "targetUserId"]),
    // ── DB auto-cascade tables (census only — must never be deleted from) ──
    customerNotificationPreferencesTable: tbl("customer_notification_preferences", ["id", "userId"]),
    clientM365ProfilesTable: tbl("client_m365_profiles", ["id", "clientId"]),
    clientAppRegistrationsTable: tbl("client_app_registrations", ["id", "clientUserId"]),
    webauthnCredentialsTable: tbl("webauthn_credentials", ["id", "userId"]),
    webauthnChallengesTable: tbl("webauthn_challenges", ["id", "userId"]),
    clientHealthHistoryTable: tbl("client_health_history", ["id", "clientId"]),
    clientCallbackTokensTable: tbl("client_callback_tokens", ["id", "clientUserId"]),
    clientScoresTable: tbl("client_scores", ["id", "clientId"]),
    clientAutomationRunsTable: tbl("client_automation_runs", ["id", "clientUserId"]),
    assessmentSowAgreementsTable: tbl("assessment_sow_agreements", ["id", "clientUserId"]),
    pushSubscriptionsTable: tbl("push_subscriptions", ["id", "userId"]),
    quickWinPresentationsTable: tbl("quick_win_presentations", ["id", "clientUserId"]),
    quickWinResultSharesTable: tbl("quick_win_result_shares", ["id", "clientUserId"]),
    mspStaffCustomerScopesTable: tbl("msp_staff_customer_scopes", ["id", "staffUserId", "createdByUserId"]),
    // ── DB auto-set-null tables (census only — must never be deleted from) ─
    projectClosuresTable: tbl("project_closures", ["id", "projectId", "signerUserId"]),
    auditLogsTable: tbl("audit_logs", ["id", "actorUserId", "clientId"]),
    azureTenantCredentialsTable: tbl("azure_tenant_credentials", ["id", "clientUserId"]),
    inboxMessageLinksTable: tbl("inbox_message_links", ["id", "customerId"]),
    scriptRunResultsTable: tbl("script_run_results", ["id", "customerId"]),
    scriptDownloadTokensTable: tbl("script_download_tokens", ["id", "customerId", "clientUserId"]),
    insightsAutomationsTable: tbl("insights_automations", ["id", "customerId"]),
    salesOffersTable: tbl("sales_offers", ["id", "customerId"]),
    salesOfferEventsTable: tbl("sales_offer_events", ["id", "actorUserId"]),
  };
});

import router from "./admin-active-directory";

const app = express();
app.use(express.json());
app.use("/api", router);

const JWT_SECRET = "admin-active-directory-delete-test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function adminToken(): string {
  return jwt.sign({ id: 1, email: "pa@platform.com", name: "Platform Admin", role: "admin", mspRole: "PlatformAdmin" }, JWT_SECRET, {
    expiresIn: "15m",
  });
}

/** Section A of the route's header comment — the audited explicit-delete
 *  order (users last). Kept in sync with the route by test failure. */
const EXPLICIT_DELETE_ORDER = [
  "workflow_steps",
  "kanban_tasks",
  "status_reports",
  "project_updates",
  "messages",
  "notifications",
  "reports",
  "client_documents",
  "documents",
  "invoices",
  "contracts",
  "emails",
  "email_domain_rules",
  "password_reset_tokens",
  "impersonation_tokens",
  "client_services",
  "projects",
  "mfa_enrollments",
  "mfa_challenges",
  "mfa_bypass_codes",
  "user_sessions",
  "user_entitlement_overrides",
  "consent_invite_tokens",
  "insights_generated_documents",
  "tenant_monitor_profiles",
  "msp_diagnostic_findings",
  "msp_diagnostic_runs",
  "msp_customer_clickwraps",
  "msp_agreement_acceptances",
  "msp_impersonation_tokens",
  "users",
];

/** Tables the DB handles itself — the route must NEVER delete from these. */
const DB_HANDLED_TABLES = [
  "customer_notification_preferences",
  "account_setup_tokens",
  "client_m365_profiles",
  "client_app_registrations",
  "webauthn_credentials",
  "webauthn_challenges",
  "client_health_history",
  "client_callback_tokens",
  "client_scores",
  "client_automation_runs",
  "assessment_sow_agreements",
  "push_subscriptions",
  "quick_win_presentations",
  "quick_win_result_shares",
  "msp_staff_customer_scopes",
  "project_closures",
  "audit_logs",
  "azure_tenant_credentials",
  "inbox_message_links",
  "script_run_results",
  "script_download_tokens",
  "insights_automations",
  "sales_offers",
  "sales_offer_events",
];

function deletedTables(): string[] {
  return h.opRecords.filter((r) => r.op === "delete").map((r) => r.table ?? "?");
}

const TARGET_ROW = { id: 42, email: "victim@customer.com", name: "Victim", mspRole: "CustomerUser", mspId: 3, tenantId: 7 };

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  h.queue.length = 0;
  h.opRecords.length = 0;
  h.auditInfoCalls.length = 0;
  h.auditWarnCalls.length = 0;
  h.txState.committed = false;
  h.txState.rolledBack = false;
  auditLogSpy.mockClear();
});

afterEach(() => {
  // Never leak a prod-gate test's NODE_ENV into the rest of the suite.
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("DELETE /admin/active-directory/user/:id — non-production gate (acceptance a)", () => {
  it("403s with NODE_ENV=production before opening a transaction or touching any table", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/dev environment/i);
    expect(h.opRecords).toHaveLength(0);
    expect(h.auditWarnCalls.length).toBe(1);
    expect(h.auditWarnCalls[0]!.payload.actionType).toBe("user.hard_delete.refused_env");
  });

  it("fails CLOSED — 403s when NODE_ENV is unset entirely", async () => {
    delete process.env.NODE_ENV;
    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unset/i);
    expect(h.opRecords).toHaveLength(0);
  });

  it("fails CLOSED — 403s on an unrecognized NODE_ENV value", async () => {
    process.env.NODE_ENV = "staging";
    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(403);
    expect(h.opRecords).toHaveLength(0);
  });

  it("401s without an admin token (requireAdmin) even in a dev environment", async () => {
    const res = await request(app).delete("/api/admin/active-directory/user/42");
    expect(res.status).toBe(401);
    expect(h.opRecords).toHaveLength(0);
  });
});

describe("DELETE /admin/active-directory/user/:id — validation", () => {
  it("400s a non-integer id", async () => {
    const res = await request(app).delete("/api/admin/active-directory/user/abc").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
    expect(h.opRecords).toHaveLength(0);
  });

  it("400s a self-delete of the acting admin", async () => {
    const res = await request(app).delete("/api/admin/active-directory/user/1").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
    expect(h.opRecords).toHaveLength(0);
  });

  it("404s an account that doesn't exist (transaction opened, nothing deleted)", async () => {
    h.queue.push([]); // target user lookup — no row
    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
    expect(deletedTables()).toHaveLength(0);
  });
});

describe("DELETE /admin/active-directory/user/:id — successful full wipe (acceptance b)", () => {
  it("deletes from every audited explicit table in dependency-safe order, users last, and never touches DB-handled tables", async () => {
    h.queue.push(
      [TARGET_ROW], // target user
      [{ id: 7, tenantGuid: "aad-guid-123" }], // owning tenant
      [{ id: 100 }, { id: 101 }], // the user's project ids
      [{ id: 200 }], // the user's client_service ids
      [{ runId: "run-1" }], // tenant's diagnostic run ids
      // Every subsequent select (the ~59 census counts) falls back to [] → 0.
    );

    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deletedUserId).toBe(42);
    expect(res.body.deletedEmail).toBe("victim@customer.com");

    // Exact set AND exact order — children before the parents they block
    // (workflow_steps/kanban_tasks → client_services → projects;
    // diagnostic findings → runs), account row dead last.
    expect(deletedTables()).toEqual(EXPLICIT_DELETE_ORDER);

    // The DB-cascade / DB-set-null tables are the DB's job — the route must
    // not have issued a delete against any of them.
    for (const table of DB_HANDLED_TABLES) {
      expect(deletedTables()).not.toContain(table);
    }

    // The whole thing ran in one committed transaction.
    expect(h.txState.committed).toBe(true);
    expect(h.txState.rolledBack).toBe(false);

    // Platform audit row written after success.
    expect(auditLogSpy).toHaveBeenCalledTimes(1);
    expect(auditLogSpy.mock.calls[0]![0].actionType).toBe("user.hard_delete");
  });

  it("logs the FULL pre-delete state to the audit channel BEFORE the transaction commits", async () => {
    h.queue.push([TARGET_ROW], [{ id: 7, tenantGuid: "aad-guid-123" }], [{ id: 100 }], [{ id: 200 }], [{ runId: "run-1" }]);

    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);

    const preState = h.auditInfoCalls.find((c) => c.payload.actionType === "user.hard_delete.pre_state");
    expect(preState).toBeDefined();
    // Captured at call time: the transaction had NOT committed yet.
    expect(preState!.committedAtCall).toBe(false);

    // Every table's row count is present: all 30 explicit tables…
    const explicitCounts = preState!.payload.explicitDeleteCounts as Record<string, number>;
    expect(Object.keys(explicitCounts).sort()).toEqual(EXPLICIT_DELETE_ORDER.filter((t) => t !== "users").sort());
    // …all 15 cascade tables and all 13 set-null reference columns
    // (sales_offers.customer_id was repointed users -> tenants by #2730 and
    // is no longer part of this census — see the route's own comment).
    expect(Object.keys(preState!.payload.dbCascadeCounts as object)).toHaveLength(15);
    expect(Object.keys(preState!.payload.dbSetNullCounts as object)).toHaveLength(13);
    expect(preState!.payload.targetUserId).toBe(42);
    expect(preState!.payload.tenantGuid).toBe("aad-guid-123");

    // And the committed marker only appears after.
    const committed = h.auditInfoCalls.find((c) => c.payload.actionType === "user.hard_delete");
    expect(committed).toBeDefined();
    expect(committed!.committedAtCall).toBe(true);
  });

  it("skips project-scoped and tenant-scoped tables when the account has no projects and no tenant linkage, but still wipes every user-keyed table", async () => {
    h.queue.push(
      [{ ...TARGET_ROW, tenantId: null, mspRole: "MSPOperator" }], // no tenant
      [], // project ids — none
      [], // client_service ids — none
      [], // diagnostic run ids — none
    );

    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);

    const deleted = deletedTables();
    // Nothing can match these without projects/services/tenant/runs — the
    // route must not issue unbounded deletes against them.
    for (const skipped of ["workflow_steps", "kanban_tasks", "tenant_monitor_profiles", "msp_diagnostic_findings"]) {
      expect(deleted).not.toContain(skipped);
    }
    // But every purely user-keyed table is still wiped, account row last.
    for (const required of ["messages", "notifications", "mfa_enrollments", "user_sessions", "msp_agreement_acceptances", "msp_impersonation_tokens"]) {
      expect(deleted).toContain(required);
    }
    expect(deleted[deleted.length - 1]).toBe("users");
  });
});

describe("DELETE /admin/active-directory/user/:id — rollback (acceptance c)", () => {
  it("rolls back the whole transaction on a mid-flight failure: 500, no users delete, no post-commit audit row", async () => {
    h.queue.push(
      [TARGET_ROW],
      [{ id: 7, tenantGuid: "aad-guid-123" }],
      new Error("simulated mid-transaction failure"), // projects lookup blows up
    );

    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/rolled back/i);

    expect(h.txState.rolledBack).toBe(true);
    expect(h.txState.committed).toBe(false);
    // No delete of any kind was issued — the failure happened first — and
    // in particular the users row was never touched.
    expect(deletedTables()).toHaveLength(0);
    // No success audit row.
    expect(auditLogSpy).not.toHaveBeenCalled();
    expect(h.auditInfoCalls.find((c) => c.payload.actionType === "user.hard_delete")).toBeUndefined();
  });

  it("rolls back when a failure happens after some deletes already ran", async () => {
    h.queue.push([TARGET_ROW], [{ id: 7, tenantGuid: "aad-guid-123" }], [{ id: 100 }], [{ id: 200 }], [{ runId: "run-1" }]);
    // Let the 59 census counts drain as 0s, then fail one of the deletes:
    // queue entries are consumed by census selects first (defaults), so to
    // hit a DELETE we pre-load enough census defaults then an Error. The
    // census makes exactly 59 count selects (30 explicit + 15 cascade + 14
    // set-null); give them explicit zeros, then fail the first delete.
    for (let i = 0; i < 59; i++) h.queue.push([{ n: 0 }]);
    h.queue.push(new Error("simulated delete failure"));

    const res = await request(app).delete("/api/admin/active-directory/user/42").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
    expect(h.txState.rolledBack).toBe(true);
    expect(h.txState.committed).toBe(false);
    // The pre-state audit line was emitted (before commit)…
    const preState = h.auditInfoCalls.find((c) => c.payload.actionType === "user.hard_delete.pre_state");
    expect(preState).toBeDefined();
    expect(preState!.committedAtCall).toBe(false);
    // …but no committed marker and no platform audit row exist.
    expect(h.auditInfoCalls.find((c) => c.payload.actionType === "user.hard_delete")).toBeUndefined();
    expect(auditLogSpy).not.toHaveBeenCalled();
    // The users row delete never ran — the very first delete failed.
    expect(deletedTables()).not.toContain("users");
  });
});
