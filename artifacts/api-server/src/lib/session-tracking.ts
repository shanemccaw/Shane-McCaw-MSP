/**
 * session-tracking.ts
 *
 * Real login-session bookkeeping backing self-service "Active Sessions" +
 * "Login History" (/settings/security) and the team-management "revoke
 * sessions for this employee" action (customer-team.tsx). One user_sessions
 * row per logical login; refresh-token rotation slides currentTokenHash on
 * the SAME row (see auth.ts /auth/refresh and mfa.ts issueFullSession)
 * instead of creating a new row per rotation, so lastActiveAt reflects real
 * session lifetime. All writes here are best-effort/non-fatal — a broken
 * session-tracking row must never block a real auth flow.
 */

import { db, userSessionsTable, mspRefreshTokensTable, type UserSession } from "@workspace/db";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "auth" });

export type SessionType = "standard" | "impersonation";
export type LoginMethod = "password" | "totp" | "sms" | "passkey" | "impersonation" | "bypass";

/** History rows past this age are pruned (see pruneOldSessions). */
const LOGIN_HISTORY_RETENTION_DAYS = 90;

export interface CreateSessionInput {
  userId: number;
  sessionType: SessionType;
  loginMethod: LoginMethod;
  /** SHA-256 hash of the raw refresh token, or null for impersonation sessions. */
  tokenHash: string | null;
  impersonatedByUserId?: number | null;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}

export async function createSession(input: CreateSessionInput): Promise<number | null> {
  try {
    const [row] = await db.insert(userSessionsTable).values({
      userId: input.userId,
      sessionType: input.sessionType,
      loginMethod: input.loginMethod,
      currentTokenHash: input.tokenHash,
      impersonatedByUserId: input.impersonatedByUserId ?? null,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      expiresAt: input.expiresAt,
    }).returning({ id: userSessionsTable.id });
    return row?.id ?? null;
  } catch (err) {
    log.warn({ err }, "session-tracking: failed to create session row (non-fatal)");
    return null;
  }
}

/** Called on sliding refresh: moves the session's token pointer forward in place. */
export async function touchSessionByTokenHash(
  oldTokenHash: string,
  newTokenHash: string,
  expiresAt: Date,
): Promise<void> {
  try {
    await db.update(userSessionsTable)
      .set({ currentTokenHash: newTokenHash, lastActiveAt: new Date(), expiresAt })
      .where(and(eq(userSessionsTable.currentTokenHash, oldTokenHash), isNull(userSessionsTable.revokedAt)));
  } catch (err) {
    log.warn({ err }, "session-tracking: failed to slide session token (non-fatal)");
  }
}

export async function revokeSessionByTokenHash(tokenHash: string): Promise<void> {
  try {
    await db.update(userSessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(userSessionsTable.currentTokenHash, tokenHash));
  } catch (err) {
    log.warn({ err }, "session-tracking: failed to revoke session by token hash (non-fatal)");
  }
}

/**
 * Revoke one session by id, scoped to the owning user. Also revokes the
 * matching msp_refresh_tokens row so the device can no longer silently
 * refresh. Returns false if the session doesn't exist / isn't the caller's.
 */
export async function revokeSessionById(userId: number, sessionId: number): Promise<boolean> {
  const [session] = await db.select().from(userSessionsTable)
    .where(and(eq(userSessionsTable.id, sessionId), eq(userSessionsTable.userId, userId)))
    .limit(1);
  if (!session) return false;

  const now = new Date();
  await db.update(userSessionsTable).set({ revokedAt: now }).where(eq(userSessionsTable.id, sessionId));
  if (session.currentTokenHash) {
    await db.update(mspRefreshTokensTable).set({ revokedAt: now })
      .where(eq(mspRefreshTokensTable.tokenHash, session.currentTokenHash));
  }
  return true;
}

/**
 * Revoke every non-revoked standard session for a user except the one
 * matching `exceptTokenHash` (pass null to revoke ALL of the user's
 * sessions, e.g. an admin force-logging-out a team member). Also revokes
 * the matching msp_refresh_tokens rows. Returns the number of sessions revoked.
 */
export async function revokeAllOtherSessions(userId: number, exceptTokenHash: string | null): Promise<number> {
  const now = new Date();
  const baseConditions = [
    eq(userSessionsTable.userId, userId),
    eq(userSessionsTable.sessionType, "standard" as SessionType),
    isNull(userSessionsTable.revokedAt),
  ];
  if (exceptTokenHash) baseConditions.push(ne(userSessionsTable.currentTokenHash, exceptTokenHash));

  const toRevoke = await db.select({ id: userSessionsTable.id, currentTokenHash: userSessionsTable.currentTokenHash })
    .from(userSessionsTable)
    .where(and(...baseConditions));
  if (toRevoke.length === 0) return 0;

  await db.update(userSessionsTable).set({ revokedAt: now }).where(and(...baseConditions));

  const tokenHashes = toRevoke.map(r => r.currentTokenHash).filter((h): h is string => !!h);
  if (tokenHashes.length > 0) {
    await db.update(mspRefreshTokensTable).set({ revokedAt: now })
      .where(and(
        eq(mspRefreshTokensTable.userId, userId),
        sql`${mspRefreshTokensTable.tokenHash} = ANY(${tokenHashes})`,
        isNull(mspRefreshTokensTable.revokedAt),
      ));
  }

  return toRevoke.length;
}

export interface ActiveSessionView {
  id: number;
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  isCurrent: boolean;
}

export async function listActiveSessions(userId: number, currentTokenHash: string | null): Promise<ActiveSessionView[]> {
  const now = new Date();
  const rows = await db.select().from(userSessionsTable)
    .where(and(
      eq(userSessionsTable.userId, userId),
      eq(userSessionsTable.sessionType, "standard" as SessionType),
      isNull(userSessionsTable.revokedAt),
      gt(userSessionsTable.expiresAt, now),
    ))
    .orderBy(desc(userSessionsTable.lastActiveAt));

  return rows.map((row): ActiveSessionView => {
    const { browser, os } = describeUserAgent(row.userAgent);
    return {
      id: row.id,
      browser,
      os,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
      isCurrent: currentTokenHash !== null && row.currentTokenHash === currentTokenHash,
    };
  });
}

export interface LoginHistoryView {
  id: number;
  loginMethod: LoginMethod;
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: Date;
  revoked: boolean;
}

/**
 * Customer-facing login history. Impersonation rows are intentionally
 * excluded — admin preview access has its own audit trail
 * (mspAuditLogsTable / IMPERSONATION_SESSION_STARTED) surfaced to admins,
 * not the end user.
 */
export async function listLoginHistory(userId: number, limit = 50): Promise<LoginHistoryView[]> {
  const rows: UserSession[] = await db.select().from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, userId), eq(userSessionsTable.sessionType, "standard" as SessionType)))
    .orderBy(desc(userSessionsTable.createdAt))
    .limit(limit);

  return rows.map((row): LoginHistoryView => {
    const { browser, os } = describeUserAgent(row.userAgent);
    return {
      id: row.id,
      loginMethod: row.loginMethod as LoginMethod,
      browser,
      os,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
      revoked: !!row.revokedAt,
    };
  });
}

/** Lightweight UA sniff — good enough for "Chrome on Windows" style labels without a new dependency. */
export function describeUserAgent(ua: string | null): { browser: string; os: string } {
  if (!ua) return { browser: "Unknown", os: "Unknown" };

  const os = /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown";

  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : "Unknown";

  return { browser, os };
}

/**
 * Prune dead (revoked or expired) session rows older than the retention
 * window. Active sessions are never touched regardless of age — a
 * long-lived sliding session's createdAt can be old even though it's still
 * in use, so retention is measured from when the session actually died
 * (COALESCE(revoked_at, expires_at)), not from login time.
 */
export async function pruneOldSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - LOGIN_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const result = await db.delete(userSessionsTable).where(
      sql`COALESCE(${userSessionsTable.revokedAt}, ${userSessionsTable.expiresAt}) < ${cutoff}`,
    );
    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) log.info({ count }, "session-tracking: pruned old session history");
    return count;
  } catch (err) {
    log.warn({ err }, "session-tracking: prune job failed (non-fatal)");
    return 0;
  }
}
