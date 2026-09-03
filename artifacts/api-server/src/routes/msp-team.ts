/**
 * msp-team.ts
 *
 * MSP-operator counterpart to `portal-team.ts` (Git #2676, part of #2567 "Feature: Team
 * Management and Invitations (MSP Console)", derived from #1656's Portal contract, extracted
 * to `docs/team-management-and-invitations-contract-pack.md` per #2447).
 *
 * The Portal file's 10 routes are all session-scoped (`req.user!.customerId`, gated by the
 * caller's own `canManageTeam` flag) — usable only by a customer-tier user managing their own
 * tenant's roster. No route there is reachable by an MSPOperator/MSPAdmin/PlatformAdmin caller
 * (`GET /portal/team` explicitly 403s a caller with no `customerId` claim), and the MSP console
 * has no route of its own for this domain at all — the real, confirmed gap this issue names.
 *
 * This file mirrors the same 10 operations against the same tables, for the same reasons, but
 * for an MSP staff caller acting on a customer elsewhere in their book:
 *
 *   GET    /api/msp/customers/:customerId/team                — roster for one customer
 *   POST   /api/msp/customers/:customerId/team/invite          — invite a teammate for that customer
 *   DELETE /api/msp/team/:userId/sessions                      — revoke all of the target's sessions
 *   PATCH  /api/msp/team/:userId/status                        — activate/suspend
 *   PATCH  /api/msp/team/:userId/mfa-enforcement                — toggle MFA enforcement
 *   POST   /api/msp/team/:userId/unlock                        — clear lockout state
 *   POST   /api/msp/team/:userId/reset-password                — email a reset link
 *   POST   /api/msp/team/:userId/temp-password                 — mint + return a temp password
 *   POST   /api/msp/team/:userId/reset-mfa                     — full MFA teardown
 *   POST   /api/msp/team/:userId/emergency-bypass               — mint a 24h MFA bypass code
 *
 * Auth model — deliberately NOT `denyIfCannotManageTeam` (the Portal file's own two-gate
 * helper): that helper's second gate, the per-user `canManageTeam` DB flag, only ever applies
 * to the customer tier — "MSP staff and PlatformAdmin bypass this second check entirely (role
 * is the gate for them)" (contract pack §0). Every route in this file is already behind
 * `requireRole("MSPOperator")`, so role is already established; the only remaining question is
 * tenant ownership + per-staff-member scoping, which is exactly what `assertCustomerAccess`
 * answers — the same helper `denyIfCannotManageTeam` itself calls first, and the same
 * ownership+scope gate every other MSP-scoped route in this repo uses
 * (`msp-active-directory.ts`, `msp-customer-timeline.ts`). A target user's tenant is resolved
 * from `usersTable.tenantId` first (404 if the user doesn't exist), then checked against the
 * caller's MSP book via `assertCustomerAccess` — mirrors the Portal file's own "404 before 403"
 * ordering exactly (contract pack §0).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import {
  db,
  usersTable,
  mfaEnrollmentsTable,
  webauthnCredentialsTable,
  userSessionsTable,
  passwordResetTokensTable,
  mfaChallengesTable,
  webauthnChallengesTable,
  mfaBypassCodesTable,
} from "@workspace/db";
import { eq, and, inArray, gte, isNull, sql, count } from "drizzle-orm";
import { requireRole, assertCustomerAccess, type AuthUser } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { revokeAllOtherSessions } from "../lib/session-tracking.ts";
import { createAuditLog } from "../lib/audit.ts";
import { getPortalBaseUrl, getMspPortalBaseUrl, buildAccountSetupUrl } from "../lib/portal-url.ts";
import { sendEmailFromTemplate, passwordResetEmail } from "../lib/mailer.ts";
import { ensureClientSetupToken } from "../lib/client-setup-token";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

function auditActor(user: AuthUser): { actorUserId: number; actorName: string; actorRole: "admin" | "client" } {
  return { actorUserId: user.id, actorName: user.name ?? user.email, actorRole: user.role };
}

/**
 * Resolve a target team member's owning tenant and confirm the caller (an MSP staff member,
 * already role-gated by requireRole above every route below) may act on that tenant.
 *
 * Returns the resolved `customerId` on success, or the HTTP status to answer with:
 * 400 for an unparseable userId, 404 when the user/tenant doesn't exist, 403 when
 * assertCustomerAccess denies (out-of-book tenant, or blocked by staff scope).
 */
async function resolveTargetCustomerId(
  req: Request,
): Promise<{ customerId: number } | { status: 400 | 403 | 404; error: string }> {
  const targetUserId = parseInt(req.params.userId as string, 10);
  if (isNaN(targetUserId)) return { status: 400, error: "Invalid userId" };

  const [target] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!target?.customerId) return { status: 404, error: "Team member not found" };

  if (!(await assertCustomerAccess(req.user!, target.customerId))) {
    return { status: 403, error: "Access to this team member is not permitted" };
  }

  return { customerId: target.customerId };
}

function reduceMfaStatus(methods: string[]): "TOTP" | "FIDO2" | "SMS" | "Disabled" {
  if (methods.includes("passkey")) return "FIDO2";
  if (methods.includes("totp")) return "TOTP";
  if (methods.includes("sms")) return "SMS";
  return "Disabled";
}

// ── GET /api/msp/customers/:customerId/team — roster for one customer ─────────

router.get("/msp/customers/:customerId/team", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(400).json({ error: "No MSP context resolved for this session" });
      return;
    }

    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }

    if (!(await assertCustomerAccess(req.user!, customerId))) {
      res.status(403).json({ error: "Access to this customer is not permitted" });
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

    const [mfaRows, passkeyRows, activeSessionRows, lastLoginRows] = await Promise.all([
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
    }));

    res.json(result);
  } catch (err) {
    log.error({ err, customerId: req.params.customerId }, "msp/customers/:customerId/team: failed to load roster");
    res.status(500).json({ error: "Failed to load team roster" });
  }
});

// ── POST /api/msp/customers/:customerId/team/invite — invite a teammate ───────

router.post("/msp/customers/:customerId/team/invite", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(400).json({ error: "No MSP context resolved for this session" });
      return;
    }

    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }

    if (!(await assertCustomerAccess(req.user!, customerId))) {
      res.status(403).json({ error: "Access to this customer is not permitted" });
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
      mspId,
      tenantId: customerId,
      mspRole: "CustomerUser",
      isActive: true,
      department: department?.trim() || null,
      jobTitle: jobTitle?.trim() || null,
    }).returning();

    void createAuditLog({
      ...auditActor(req.user!),
      actionType: "team_member_invited",
      entityType: "user",
      entityId: newUser.id,
      entityLabel: newUser.name ?? newUser.email,
      metadata: { actorSurface: "msp", customerId },
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
      ).catch((e) => log.warn({ err: e, userId: newUser.id, template: "account-setup" }, "msp/team/invite: invite email failed (non-fatal)"));
    } catch (err) {
      log.warn({ err, userId: newUser.id }, "msp/team/invite: failed to generate setup token/send invite email");
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    log.error({ err, customerId: req.params.customerId }, "msp/customers/:customerId/team/invite: failed to invite teammate");
    res.status(500).json({ error: "Failed to invite teammate" });
  }
});

// ── DELETE /api/msp/team/:userId/sessions ──────────────────────────────────────

router.delete("/msp/team/:userId/sessions", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTargetCustomerId(req);
    if ("status" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const targetUserId = parseInt(req.params.userId as string, 10);
    const revokedCount = await revokeAllOtherSessions(targetUserId, null);
    res.json({ ok: true, revokedCount });
  } catch (err) {
    log.error({ err, userId: req.params.userId }, "msp/team/:userId/sessions: failed to revoke sessions");
    res.status(500).json({ error: "Failed to revoke sessions" });
  }
});

// ── PATCH /api/msp/team/:userId/status ─────────────────────────────────────────

router.patch("/msp/team/:userId/status", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body as { isActive?: boolean };
    if (typeof isActive !== "boolean") {
      res.status(400).json({ error: "isActive must be a boolean" });
      return;
    }

    const resolved = await resolveTargetCustomerId(req);
    if ("status" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const targetUserId = parseInt(req.params.userId as string, 10);

    if (targetUserId === req.user!.id && !isActive) {
      res.status(400).json({ error: "You cannot suspend your own account" });
      return;
    }

    await db.update(usersTable).set({ isActive }).where(eq(usersTable.id, targetUserId));

    void createAuditLog({
      ...auditActor(req.user!),
      actionType: isActive ? "team_member_activated" : "team_member_suspended",
      entityType: "user",
      entityId: targetUserId,
      metadata: { actorSurface: "msp", customerId: resolved.customerId },
    });

    if (!isActive) {
      void revokeAllOtherSessions(targetUserId, null).catch((e) =>
        log.warn({ err: e, userId: targetUserId }, "msp/team/status: failed to revoke sessions after suspend"));
    }

    res.json({ ok: true, isActive });
  } catch (err) {
    log.error({ err, userId: req.params.userId }, "msp/team/:userId/status: failed to update status");
    res.status(500).json({ error: "Failed to update status" });
  }
});

// ── PATCH /api/msp/team/:userId/mfa-enforcement ────────────────────────────────

router.patch("/msp/team/:userId/mfa-enforcement", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const { enforced } = req.body as { enforced?: boolean };
    if (typeof enforced !== "boolean") {
      res.status(400).json({ error: "enforced must be a boolean" });
      return;
    }

    const resolved = await resolveTargetCustomerId(req);
    if ("status" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const targetUserId = parseInt(req.params.userId as string, 10);
    await db.update(usersTable).set({ mfaEnforced: enforced }).where(eq(usersTable.id, targetUserId));

    void createAuditLog({
      ...auditActor(req.user!),
      actionType: enforced ? "team_member_mfa_enforcement_enabled" : "team_member_mfa_enforcement_disabled",
      entityType: "user",
      entityId: targetUserId,
      metadata: { actorSurface: "msp", customerId: resolved.customerId },
    });

    res.json({ ok: true, mfaEnforced: enforced });
  } catch (err) {
    log.error({ err, userId: req.params.userId }, "msp/team/:userId/mfa-enforcement: failed to update");
    res.status(500).json({ error: "Failed to update MFA enforcement" });
  }
});

// ── POST /api/msp/team/:userId/unlock ──────────────────────────────────────────

router.post("/msp/team/:userId/unlock", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTargetCustomerId(req);
    if ("status" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const targetUserId = parseInt(req.params.userId as string, 10);
    await db
      .update(usersTable)
      .set({ failedLoginAttempts: 0, lastFailedLoginAt: null, lockedUntil: null })
      .where(eq(usersTable.id, targetUserId));

    void createAuditLog({
      ...auditActor(req.user!),
      actionType: "team_member_unlocked",
      entityType: "user",
      entityId: targetUserId,
      metadata: { actorSurface: "msp", customerId: resolved.customerId },
    });

    res.json({ ok: true, isLockedOut: false });
  } catch (err) {
    log.error({ err, userId: req.params.userId }, "msp/team/:userId/unlock: failed to unlock");
    res.status(500).json({ error: "Failed to unlock account" });
  }
});

const TEAM_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, matches /auth/forgot-password and portal-team.ts

// ── POST /api/msp/team/:userId/reset-password ──────────────────────────────────

router.post("/msp/team/:userId/reset-password", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTargetCustomerId(req);
    if ("status" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const targetUserId = parseInt(req.params.userId as string, 10);
    const [target] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Team member not found" });
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
    ).catch((e) => log.warn({ err: e, userId: targetUserId }, "msp/team/reset-password: email failed (non-fatal)"));

    void createAuditLog({
      ...auditActor(req.user!),
      actionType: "team_member_password_reset_email_sent",
      entityType: "user",
      entityId: targetUserId,
      entityLabel: target.name ?? target.email,
      metadata: { actorSurface: "msp", customerId: resolved.customerId },
    });

    res.json({ ok: true });
  } catch (err) {
    log.error({ err, userId: req.params.userId }, "msp/team/:userId/reset-password: failed to reset password");
    res.status(500).json({ error: "Failed to send reset email" });
  }
});

// ── POST /api/msp/team/:userId/temp-password ───────────────────────────────────

router.post("/msp/team/:userId/temp-password", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTargetCustomerId(req);
    if ("status" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const targetUserId = parseInt(req.params.userId as string, 10);
    const [target] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    const { randomBytes } = await import("crypto");
    const tempPassword = `Temp-${randomBytes(6).toString("hex").toUpperCase()}!9`;
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, targetUserId));

    void createAuditLog({
      ...auditActor(req.user!),
      actionType: "team_member_temp_password_set",
      entityType: "user",
      entityId: targetUserId,
      entityLabel: target.name ?? target.email,
      metadata: { actorSurface: "msp", customerId: resolved.customerId },
    });

    res.json({ ok: true, tempPassword });
  } catch (err) {
    log.error({ err, userId: req.params.userId }, "msp/team/:userId/temp-password: failed to set temp password");
    res.status(500).json({ error: "Failed to set temp password" });
  }
});

// ── POST /api/msp/team/:userId/reset-mfa ───────────────────────────────────────

router.post("/msp/team/:userId/reset-mfa", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTargetCustomerId(req);
    if ("status" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const targetUserId = parseInt(req.params.userId as string, 10);
    const [target] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Team member not found" });
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
    ).catch((e) => log.warn({ err: e, userId: targetUserId }, "msp/team/reset-mfa: email failed (non-fatal)"));

    void createAuditLog({
      ...auditActor(req.user!),
      actionType: "team_member_mfa_reset",
      entityType: "user",
      entityId: targetUserId,
      entityLabel: target.name ?? target.email,
      metadata: { actorSurface: "msp", customerId: resolved.customerId, clearedMethods },
    });

    res.json({ ok: true, clearedMethods });
  } catch (err) {
    log.error({ err, userId: req.params.userId }, "msp/team/:userId/reset-mfa: failed to reset MFA");
    res.status(500).json({ error: "Failed to reset MFA" });
  }
});

// ── POST /api/msp/team/:userId/emergency-bypass ────────────────────────────────

router.post("/msp/team/:userId/emergency-bypass", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTargetCustomerId(req);
    if ("status" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const targetUserId = parseInt(req.params.userId as string, 10);
    const [target] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Team member not found" });
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
      customerId: resolved.customerId,
      expiresAt,
    });

    void createAuditLog({
      ...auditActor(req.user!),
      actionType: "team_member_emergency_bypass_generated",
      entityType: "user",
      entityId: targetUserId,
      entityLabel: target.name ?? target.email,
      metadata: { actorSurface: "msp", customerId: resolved.customerId, expiresAt: expiresAt.toISOString() },
    });

    res.json({ ok: true, bypassCode, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    log.error({ err, userId: req.params.userId }, "msp/team/:userId/emergency-bypass: failed to generate bypass code");
    res.status(500).json({ error: "Failed to generate emergency bypass code" });
  }
});

export default router;
