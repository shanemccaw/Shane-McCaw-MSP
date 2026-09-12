import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, mfaEnrollmentsTable, webauthnCredentialsTable, userSessionsTable, passwordResetTokensTable, mfaChallengesTable, webauthnChallengesTable, mfaBypassCodesTable } from "@workspace/db";
import { eq, and, inArray, gte, isNull, sql, count } from "drizzle-orm";
import { requireAuth, assertCustomerAccess, type AuthUser } from "../middlewares/requireAuth.ts";
import { userHasCapability, setGrantRole, usersHoldingGrantRole } from "../middlewares/rbac-capability.ts";
import { revokeAllOtherSessions } from "../lib/session-tracking.ts";
import { createAuditLog } from "../lib/audit.ts";
import { getPortalBaseUrl, getMspPortalBaseUrl, buildAccountSetupUrl } from "../lib/portal-url.ts";
import { sendEmailFromTemplate, passwordResetEmail } from "../lib/mailer.ts";
import { ensureClientSetupToken } from "../lib/client-setup-token";
import { logger } from "../lib/logger.ts";
import { LEGACY_ROLE, CUSTOMER_PLATFORM_ROLE_KEYS } from "@workspace/db/rbac/legacy-ladder";

/**
 * The two `customer_roles.key` values a Customer Admin may actually assign
 * (#3629's platform-default roles) — never an org's own custom role, and
 * never any other string a caller might guess. See #3647.
 */
const ASSIGNABLE_CUSTOMER_ROLE_KEYS: ReadonlySet<string> = new Set(Object.values(CUSTOMER_PLATFORM_ROLE_KEYS));
const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/**
 * Authorization for a MUTATING /portal/team route (Git #1142).
 *
 * Before this existed every mutating route gated only on assertCustomerAccess,
 * which enforces tenant isolation but NOT privilege within a tenant — so any
 * plain Customer could invite/suspend/reset-password/disable-MFA/unlock/
 * emergency-bypass their own company's other users by direct API call. This
 * closes that gap with two ordered gates:
 *
 *  1. Tenant isolation via assertCustomerAccess — the caller must be entitled to
 *     touch this customer at all (own tenant for customer-tier users; in-MSP +
 *     staff-scope for MSP staff; anything for PlatformAdmin).
 *  2. Team-admin capability — `customer:team.manage`. A customer-tier user
 *     (Customer/Free) must ADDITIONALLY hold it; MSP staff and
 *     PlatformAdmin hold it by virtue of their role and are not subject to a
 *     per-user grant. There is no "CustomerAdmin" rung, so this capability is the
 *     elevated-customer distinction.
 *
 * ── #2460 — where that second gate now reads from ──────────────────────────
 *
 * Until #2460 this was the per-user `users.can_manage_team` column, read live in
 * this function. #2457 expressed it as rows — the users who carried the column hold
 * the `cap.team.manage` customer role, and the `customer:team.manage` mapping row's
 * allow set is {cap.team.manage, MSPAdmin, MSPOperator, PlatformAdmin,
 * ServiceAccount}. That set is the transcription of the exact rule above, including
 * the artifact that `ServiceAccount` passes without a grant because the live test
 * was an allow-list of three tier NAMES rather than a rung comparison (#1696 records
 * this; `legacy-ladder.test.ts` pins it). The column is retired; the answer is the
 * same one, from the database.
 *
 * Still read LIVE, never trusted from the JWT, so a revoke takes effect immediately
 * without waiting for token refresh — the property Git #1142 chose the column shape
 * for in the first place, preserved deliberately.
 *
 * ── #3360 — the second gate fails closed on its own ────────────────────────
 *
 * Before #2460 the privilege half tested `isCustomerTier` and returned "permitted" for
 * every role it did not name — including a caller with no `mspRole` claim at all,
 * which `buildUserPayload` really can sign. Only assertCustomerAccess in front of it,
 * which ends in `return false`, kept that unreachable. The capability read has no such
 * branch: a claim naming no rung contributes no role, so the caller is decided on
 * explicit `cap.*` grants alone and denied by default. portal-team.test.ts pins this
 * with gate 1 forced open, so the second gate is proven to hold by itself.
 *
 * This is deliberately NOT `requireCapability`. That middleware decides the seven
 * platform `ladder.*` keys only (requireCapability-keys.test.ts enforces it, and a
 * `customer:` key would 503), and it runs before the handler knows whose team is being
 * touched — the tenant-isolation half needs the TARGET's tenant, which only exists
 * after each route's own lookup.
 *
 * Returns the HTTP status to answer with on denial, or null when the caller may
 * proceed. Both denial reasons answer 403 and never leak which gate failed — except
 * an unreadable/unseeded model, which is 503 and NOT a denial (see
 * rbac-capability.ts's header on why those two must not look alike).
 */
async function denyIfCannotManageTeam(user: AuthUser, targetCustomerId: number): Promise<number | null> {
  const allowed = await assertCustomerAccess(user, targetCustomerId);
  if (!allowed) return 403;

  const outcome = await userHasCapability(user, "customer", "team.manage");
  if (outcome.kind === "allow") return null;
  return outcome.kind === "unavailable" ? 503 : 403;
}

router.delete("/portal/team/:userId/sessions", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [targetMspUser] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);

  if (!targetMspUser?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, targetMspUser.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  const revokedCount = await revokeAllOtherSessions(targetUserId, null);
  res.json({ ok: true, revokedCount });
});

router.post("/portal/team/invite", requireAuth, async (req: Request, res: Response) => {
  const inviterCustomerId = req.user!.customerId;
  const inviterMspId = req.user!.mspId;
  if (!inviterCustomerId || !inviterMspId) {
    res.status(403).json({ error: "Only customer team members can invite teammates" });
    return;
  }

  // Git #1142 — inviting a teammate is team management; gate on the caller's
  // live canManageTeam capability (assertCustomerAccess against their own tenant
  // always passes, so this is purely the privilege check).
  const inviteDeny = await denyIfCannotManageTeam(req.user!, inviterCustomerId);
  if (inviteDeny) {
    res.status(inviteDeny).json({ error: "You do not have permission to manage your team" });
    return;
  }

  const { email, name, department, jobTitle } = req.body as {
    email?: string;
    name?: string;
    department?: string;
    jobTitle?: string;
  };
  if (!email || !email.trim()) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  const normalizedEmail = email.toLowerCase().trim();

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const [newUser] = await db.insert(usersTable).values({
    email: normalizedEmail,
    passwordHash: null,
    role: "client",
    name: name?.trim() || null,
    mspId: inviterMspId,
    tenantId: inviterCustomerId,
    mspRole: LEGACY_ROLE.customer,
    isActive: true,
    department: department?.trim() || null,
    jobTitle: jobTitle?.trim() || null,
  }).returning();

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "team_member_invited",
    entityType: "user",
    entityId: newUser.id,
    entityLabel: newUser.name ?? newUser.email,
  });

  try {
    const { token: setupToken } = await ensureClientSetupToken(newUser.id);
    const setupUrl = buildAccountSetupUrl(setupToken);
    void sendEmailFromTemplate(
      "account-setup",
      newUser.email,
      { setupLink: setupUrl, clientName: newUser.name ?? newUser.email },
      "You've been invited to join your company's Shane McCaw Consulting portal",
      `<p>Hi ${newUser.name ?? ""},</p><p>${req.user!.name ?? req.user!.email} has invited you to join their team's client portal. Click the link below to create your password and access your workspace:</p><p style="margin:24px 0;"><a href="${setupUrl}" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Set up my portal →</a></p><p style="color:#888;font-size:13px;">This link expires in 72 hours.</p><p>— Shane McCaw</p>`,
    ).catch((e) => log.warn({ err: e, userId: newUser.id, template: "account-setup" }, "portal/team/invite: invite email failed (non-fatal)"));
  } catch (err) {
    log.warn({ err, userId: newUser.id }, "portal/team/invite: failed to generate setup token/send invite email");
  }

  res.status(201).json({ ok: true });
});

function reduceMfaStatus(methods: string[]): "TOTP" | "FIDO2" | "SMS" | "Disabled" {
  if (methods.includes("passkey")) return "FIDO2";
  if (methods.includes("totp")) return "TOTP";
  if (methods.includes("sms")) return "SMS";
  return "Disabled";
}

router.get("/portal/team", requireAuth, async (req: Request, res: Response) => {
  const customerId = req.user!.customerId;
  if (!customerId) {
    res.status(403).json({ error: "Only customer team members can view the team roster" });
    return;
  }

  const members = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      phone: usersTable.phone,
      isActive: usersTable.isActive,
      mfaEnforced: usersTable.mfaEnforced,
      lockedUntil: usersTable.lockedUntil,
      department: usersTable.department,
      jobTitle: usersTable.jobTitle,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.tenantId, customerId));

  if (members.length === 0) {
    res.json([]);
    return;
  }

  const userIds = members.map((m) => m.userId);

  const [mfaRows, passkeyRows, activeSessionRows, lastLoginRows, customerAdminIds, billingRoleIds] = await Promise.all([
    db.select({ userId: mfaEnrollmentsTable.userId, method: mfaEnrollmentsTable.method })
      .from(mfaEnrollmentsTable)
      .where(and(inArray(mfaEnrollmentsTable.userId, userIds), eq(mfaEnrollmentsTable.enabled, true))),
    db.select({ userId: webauthnCredentialsTable.userId })
      .from(webauthnCredentialsTable)
      .where(inArray(webauthnCredentialsTable.userId, userIds)),
    db.select({ userId: userSessionsTable.userId, activeCount: count() })
      .from(userSessionsTable)
      .where(and(
        inArray(userSessionsTable.userId, userIds),
        eq(userSessionsTable.sessionType, "standard"),
        isNull(userSessionsTable.revokedAt),
        gte(userSessionsTable.expiresAt, new Date()),
      ))
      .groupBy(userSessionsTable.userId),
    db.select({ userId: userSessionsTable.userId, lastLogin: sql<string>`max(${userSessionsTable.createdAt})` })
      .from(userSessionsTable)
      .where(and(inArray(userSessionsTable.userId, userIds), eq(userSessionsTable.sessionType, "standard")))
      .groupBy(userSessionsTable.userId),
    // #3647 — who on this roster holds the two #3629 platform roles, so a
    // Customer Admin sees current grants rather than guessing before toggling
    // them via PATCH /portal/team/:userId/role. `null` (unseeded model) reads
    // as "nobody", never as a 500 on an otherwise-working roster read.
    usersHoldingGrantRole("customer", CUSTOMER_PLATFORM_ROLE_KEYS.customerAdmin, userIds),
    usersHoldingGrantRole("customer", CUSTOMER_PLATFORM_ROLE_KEYS.billing, userIds),
  ]);

  const methodsByUser = new Map<number, string[]>();
  for (const row of mfaRows) {
    const list = methodsByUser.get(row.userId) ?? [];
    list.push(row.method);
    methodsByUser.set(row.userId, list);
  }
  for (const row of passkeyRows) {
    const list = methodsByUser.get(row.userId) ?? [];
    list.push("passkey");
    methodsByUser.set(row.userId, list);
  }
  const activeCountByUser = new Map(activeSessionRows.map((r) => [r.userId, r.activeCount]));
  const lastLoginByUser = new Map(lastLoginRows.map((r) => [r.userId, r.lastLogin]));

  const result = members.map((m) => ({
    id: m.userId,
    userId: m.userId,
    email: m.email,
    name: m.name,
    phone: m.phone,
    isActive: m.isActive,
    isLockedOut: Boolean(m.lockedUntil && m.lockedUntil > new Date()),
    mfaStatus: reduceMfaStatus(methodsByUser.get(m.userId) ?? []),
    mfaEnforced: m.mfaEnforced,
    department: m.department ?? "",
    jobTitle: m.jobTitle ?? "",
    lastLoginAt: lastLoginByUser.get(m.userId) ?? null,
    createdAt: m.createdAt,
    activeSessionsCount: activeCountByUser.get(m.userId) ?? 0,
    isCustomerAdmin: customerAdminIds?.has(m.userId) ?? false,
    hasBillingRole: billingRoleIds?.has(m.userId) ?? false,
  }));

  res.json(result);
});

router.patch("/portal/team/:userId/status", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const { isActive } = req.body as { isActive?: boolean };
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }

  const [targetMspUser] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!targetMspUser?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, targetMspUser.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  if (targetUserId === req.user!.id && !isActive) {
    res.status(400).json({ error: "You cannot suspend your own account" });
    return;
  }

  await db.update(usersTable).set({ isActive }).where(eq(usersTable.id, targetUserId));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: isActive ? "team_member_activated" : "team_member_suspended",
    entityType: "user",
    entityId: targetUserId,
  });

  if (!isActive) {
    void revokeAllOtherSessions(targetUserId, null).catch((e) =>
      log.warn({ err: e, userId: targetUserId }, "portal/team/status: failed to revoke sessions after suspend"));
  }

  res.json({ ok: true, isActive });
});

// ─── CLIENT: Team member platform role assignment (Billing / Customer Admin) ─
//
// #3629 seeded two platform-default customer roles (`customer-admin`, `billing`)
// but the only grant path was AdminV2 RBAC (`/admin/rbac/*`, PlatformAdmin-only,
// #2461) — nobody inside a customer org could grant either. This is the portal-
// side grant surface a Customer Admin actually reaches: gated identically to
// every other mutating team route (tenant isolation + `customer:team.manage`),
// and restricted to the two platform-scoped keys #3629 seeded — never an org's
// own custom role, and never any other role name a caller might guess. Reuses
// the exact grant/revoke primitive #2460 built for `cap.team.manage` etc.
// (`setGrantRole`/`usersHoldingGrantRole` in rbac-capability.ts) — a
// `customer_roles` membership row is a membership row regardless of which key
// it names.
router.patch("/portal/team/:userId/role", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const { role, granted } = req.body as { role?: string; granted?: boolean };
  if (typeof role !== "string" || !ASSIGNABLE_CUSTOMER_ROLE_KEYS.has(role)) {
    res.status(400).json({ error: `role must be one of: ${[...ASSIGNABLE_CUSTOMER_ROLE_KEYS].join(", ")}` });
    return;
  }
  if (typeof granted !== "boolean") {
    res.status(400).json({ error: "granted must be a boolean" });
    return;
  }

  const [target] = await db
    .select({ customerId: usersTable.tenantId, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!target?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, target.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  if (targetUserId === req.user!.id && role === CUSTOMER_PLATFORM_ROLE_KEYS.customerAdmin && !granted) {
    res.status(400).json({ error: "You cannot remove your own Customer Admin role" });
    return;
  }

  const result = await setGrantRole("customer", targetUserId, role, granted, req.user!.id);
  if (!result.ok) {
    res.status(503).json({ error: "Role assignment is temporarily unavailable" });
    return;
  }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: granted ? "team_member_role_granted" : "team_member_role_revoked",
    entityType: "user",
    entityId: targetUserId,
    entityLabel: target.name ?? target.email,
    metadata: { role },
  });

  res.json({ ok: true, userId: targetUserId, role, granted });
});

// ─── CLIENT: Team member reports-to (manager) assignment (#2527) ────────────
//
// The real, buildable half of #1519's "escalates internally, to the assigner
// or up their chain": a self-referencing manager pointer on `users`
// (`managerUserId`), set here by a real person with `canManageTeam`, not
// synced from anywhere. `notifyOwnershipDeclined` (notification-center.ts)
// walks this chain when populated. Starts null on every row — this endpoint
// is the only writer.
router.patch("/portal/team/:userId/manager", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const { managerUserId } = req.body as { managerUserId?: number | null };
  if (managerUserId !== null && typeof managerUserId !== "number") {
    res.status(400).json({ error: "managerUserId must be a number or null" });
    return;
  }

  const [target] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!target?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, target.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  if (managerUserId !== null) {
    if (managerUserId === targetUserId) {
      res.status(400).json({ error: "A team member cannot be their own manager" });
      return;
    }

    const [candidate] = await db
      .select({ id: usersTable.id, tenantId: usersTable.tenantId, managerUserId: usersTable.managerUserId })
      .from(usersTable)
      .where(eq(usersTable.id, managerUserId))
      .limit(1);
    if (!candidate || candidate.tenantId !== target.customerId) {
      res.status(400).json({ error: "managerUserId must be a member of the same team" });
      return;
    }

    // Cycle guard: walk the candidate's own chain upward — if targetUserId
    // shows up, assigning this manager would close a loop.
    let cursor: number | null = candidate.managerUserId;
    let hops = 0;
    while (cursor !== null && hops < 50) {
      if (cursor === targetUserId) {
        res.status(400).json({ error: "That assignment would create a reporting-chain cycle" });
        return;
      }
      const [next]: { managerUserId: number | null }[] = await db
        .select({ managerUserId: usersTable.managerUserId })
        .from(usersTable)
        .where(eq(usersTable.id, cursor))
        .limit(1);
      cursor = next?.managerUserId ?? null;
      hops++;
    }
  }

  await db.update(usersTable).set({ managerUserId }).where(eq(usersTable.id, targetUserId));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "team_member_manager_set",
    entityType: "user",
    entityId: targetUserId,
  });

  res.json({ ok: true, managerUserId });
});

// ─── CLIENT: Team member MFA enforcement toggle ──────────────────────────────
router.patch("/portal/team/:userId/mfa-enforcement", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const { enforced } = req.body as { enforced?: boolean };
  if (typeof enforced !== "boolean") {
    res.status(400).json({ error: "enforced must be a boolean" });
    return;
  }

  const [targetMspUser] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!targetMspUser?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, targetMspUser.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  await db.update(usersTable).set({ mfaEnforced: enforced }).where(eq(usersTable.id, targetUserId));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: enforced ? "team_member_mfa_enforcement_enabled" : "team_member_mfa_enforcement_disabled",
    entityType: "user",
    entityId: targetUserId,
  });

  res.json({ ok: true, mfaEnforced: enforced });
});

router.post("/portal/team/:userId/unlock", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [targetMspUser] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!targetMspUser?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, targetMspUser.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  await db
    .update(usersTable)
    .set({ failedLoginAttempts: 0, lastFailedLoginAt: null, lockedUntil: null })
    .where(eq(usersTable.id, targetUserId));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "team_member_unlocked",
    entityType: "user",
    entityId: targetUserId,
  });

  res.json({ ok: true, isLockedOut: false });
});

const TEAM_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, matches /auth/forgot-password

router.post("/portal/team/:userId/reset-password", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [target] = await db
    .select({ customerId: usersTable.tenantId, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!target?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, target.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  const { randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TEAM_RESET_TOKEN_TTL_MS);
  await db.insert(passwordResetTokensTable).values({ userId: targetUserId, token, expiresAt });

  const resetUrl = `${getPortalBaseUrl()}/reset-password?token=${token}`;
  void sendEmailFromTemplate(
    "password-reset",
    target.email,
    { resetLink: resetUrl },
    "Reset your Shane McCaw Consulting portal password",
    passwordResetEmail({ resetUrl }),
  ).catch((e) => log.warn({ err: e, userId: targetUserId }, "portal/team/reset-password: email failed (non-fatal)"));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "team_member_password_reset_email_sent",
    entityType: "user",
    entityId: targetUserId,
    entityLabel: target.name ?? target.email,
  });

  res.json({ ok: true });
});

router.post("/portal/team/:userId/temp-password", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [target] = await db
    .select({ customerId: usersTable.tenantId, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!target?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, target.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  const { randomBytes } = await import("crypto");
  const tempPassword = `Temp-${randomBytes(6).toString("hex").toUpperCase()}!9`;
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, targetUserId));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "team_member_temp_password_set",
    entityType: "user",
    entityId: targetUserId,
    entityLabel: target.name ?? target.email,
  });

  res.json({ ok: true, tempPassword });
});

router.post("/portal/team/:userId/reset-mfa", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [target] = await db
    .select({ customerId: usersTable.tenantId, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!target?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, target.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  const enrollments = await db
    .select({ method: mfaEnrollmentsTable.method })
    .from(mfaEnrollmentsTable)
    .where(eq(mfaEnrollmentsTable.userId, targetUserId));
  const passkeyRows = await db
    .select({ id: webauthnCredentialsTable.id })
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, targetUserId));

  const clearedMethods: string[] = enrollments.map((e) => e.method);
  if (passkeyRows.length > 0) clearedMethods.push("passkey");

  await db.delete(mfaEnrollmentsTable).where(eq(mfaEnrollmentsTable.userId, targetUserId));
  await db.delete(mfaChallengesTable).where(eq(mfaChallengesTable.userId, targetUserId));
  await db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, targetUserId));
  await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.userId, targetUserId));

  void sendEmailFromTemplate(
    "mfa-reset",
    target.email,
    {
      clientName: target.name ?? target.email,
      methodsList: clearedMethods.map((m) => (m === "totp" ? "Authenticator App (TOTP)" : m === "sms" ? "SMS" : m === "passkey" ? "Passkey / Security Key" : m)).join(", ") || "None",
      loginLink: getMspPortalBaseUrl(),
      securityLink: `${getMspPortalBaseUrl()}/security`,
    },
    "Your two-factor authentication has been reset",
    `<p>Hi ${target.name ?? target.email},</p><p>Your MFA has been reset by a teammate. Please sign in and set up a new authentication method.</p><p><a href="${getMspPortalBaseUrl()}">Sign in to your portal</a></p>`,
  ).catch((e) => log.warn({ err: e, userId: targetUserId }, "portal/team/reset-mfa: email failed (non-fatal)"));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "team_member_mfa_reset",
    entityType: "user",
    entityId: targetUserId,
    entityLabel: target.name ?? target.email,
    metadata: { clearedMethods },
  });

  res.json({ ok: true, clearedMethods });
});

router.post("/portal/team/:userId/emergency-bypass", requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [target] = await db
    .select({ customerId: usersTable.tenantId, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!target?.customerId) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const denyStatus = await denyIfCannotManageTeam(req.user!, target.customerId);
  if (denyStatus) {
    res.status(denyStatus).json({ error: "Access to this team member is not permitted" });
    return;
  }

  // Cryptographically random 64-bit code, grouped for legibility. Uppercased so
  // the login-side comparison can normalize case without changing entropy.
  const { randomBytes } = await import("crypto");
  const raw = randomBytes(8).toString("hex").toUpperCase(); // 16 hex chars
  const bypassCode = `EMERGENCY-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  const codeHash = await bcrypt.hash(bypassCode, 12);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Enforce "one active code per user" — clear any prior (used or unused) code
  // before issuing the new one.
  await db.delete(mfaBypassCodesTable).where(eq(mfaBypassCodesTable.userId, targetUserId));
  await db.insert(mfaBypassCodesTable).values({
    userId: targetUserId,
    codeHash,
    createdByUserId: req.user!.id,
    customerId: target.customerId,
    expiresAt,
  });

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "team_member_emergency_bypass_generated",
    entityType: "user",
    entityId: targetUserId,
    entityLabel: target.name ?? target.email,
    metadata: { expiresAt: expiresAt.toISOString() },
  });

  res.json({ ok: true, bypassCode, expiresAt: expiresAt.toISOString() });
});

export default router;
