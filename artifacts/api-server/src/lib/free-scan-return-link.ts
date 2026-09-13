/**
 * free-scan-return-link.ts — Git #1359 (Phase 7 of Feature #1352, Free Scan).
 *
 * The emailed "view your free scan results" link that lets a passwordless Free
 * Scan Prospect come back to their own results later, WITHOUT a portal login.
 *
 * ── Why this is not /setup-password ───────────────────────────────────────────
 * The existing passwordless return mechanism (account_setup_tokens, exchanged by
 * POST /auth/setup-password for a password AND a real session) is gated by
 * hasRealEntitlement() because of #656: forgot-password once handed that token
 * to any passwordless account, including unpaid consent-time Prospects. A Free
 * Scan Prospect has no entitlement by definition, so reusing that path would
 * either be refused (correct) or require weakening the gate (never).
 *
 * ── What this capability is, exhaustively ─────────────────────────────────────
 * A token here authorises exactly one thing: POST /api/public/free-scan/results
 * returns the scan summary of the one tenants row it was minted for. Structurally:
 *
 *   - Its own table (free_scan_return_links), with a CHECK pinning `purpose` to
 *     'free_scan_results'. No /auth/* route, no JWT middleware and no session
 *     code reads this table, so presenting the token anywhere else is presenting
 *     a string nothing recognises.
 *   - Its own token shape: `fsr_` + 43 base64url chars. account_setup_tokens and
 *     password_reset_tokens are 64-char hex; a JWT has two dots. Resolution
 *     refuses anything not matching the fsr_ shape before touching the database.
 *   - Only sha256(token) is stored, so a read of the table cannot be replayed.
 *   - Resolution re-checks, every time, that the account is STILL an unentitled
 *     Free Prospect linked to that same customer. A Prospect who converts gets a
 *     real login through the normal hardened path; their old link stops working
 *     rather than becoming a second door into a now-entitled account.
 *   - Nothing here mints, signs or returns a JWT, refresh token or cookie.
 */

import { createHash, randomBytes } from "crypto";
import {
  db,
  freeScanReturnLinksTable,
  usersTable,
  clientServicesTable,
} from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import { getEmailTemplateOrFallback, sendEmailOrThrow } from "./mailer.ts";
import { buildFreeScanResultsUrl } from "./portal-url.ts";
import { logger } from "./logger.ts";

// Proof-of-link for an identity, like the other token flows in routes/auth.ts.
const log = logger.child({ channel: "auth" });

export const FREE_SCAN_RETURN_TOKEN_PREFIX = "fsr_";
export const FREE_SCAN_RETURN_PURPOSE = "free_scan_results";
/** Long enough to come back after the scan finishes and a colleague has looked; short enough to age out. */
export const FREE_SCAN_RETURN_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const TOKEN_RE = /^fsr_[A-Za-z0-9_-]{43}$/;

export function hashFreeScanReturnToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export type FreeScanProspect = {
  userId: number;
  customerId: number;
  email: string;
  name: string | null;
};

/**
 * The account a return link may be minted for or resolved against: an active,
 * `Free`-role user linked to a tenant, with NO client_services row (the same
 * input hasRealEntitlement() reads). Anything else gets null.
 */
export async function loadEligibleFreeScanProspect(userId: number): Promise<FreeScanProspect | null> {
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      mspRole: usersTable.mspRole,
      tenantId: usersTable.tenantId,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user || !user.isActive || user.mspRole !== LEGACY_ROLE.free || user.tenantId == null) return null;

  const [entitlement] = await db
    .select({ id: clientServicesTable.id })
    .from(clientServicesTable)
    .where(eq(clientServicesTable.clientUserId, user.id))
    .limit(1);
  if (entitlement) return null;

  return { userId: user.id, customerId: user.tenantId, email: user.email, name: user.name };
}

/**
 * Mint a fresh return link for an eligible Prospect. Earlier live links for the
 * same user are revoked, so at most one is ever outstanding.
 */
export async function mintFreeScanReturnLink(
  userId: number,
): Promise<{ token: string; expiresAt: Date; prospect: FreeScanProspect } | null> {
  const prospect = await loadEligibleFreeScanProspect(userId);
  if (!prospect) return null;

  const token = FREE_SCAN_RETURN_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + FREE_SCAN_RETURN_LINK_TTL_MS);

  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(freeScanReturnLinksTable)
      .set({ revokedAt: now })
      .where(and(eq(freeScanReturnLinksTable.userId, userId), isNull(freeScanReturnLinksTable.revokedAt)));
    await tx.insert(freeScanReturnLinksTable).values({
      tokenHash: hashFreeScanReturnToken(token),
      purpose: FREE_SCAN_RETURN_PURPOSE,
      userId,
      customerId: prospect.customerId,
      expiresAt,
    });
  });

  return { token, expiresAt, prospect };
}

export type ResolveFreeScanReturnLinkResult =
  | { ok: true; userId: number; customerId: number }
  | { ok: false; reason: "invalid" | "expired" | "not_applicable" };

/** Resolve a presented token to the one customer whose results it may read. */
export async function resolveFreeScanReturnLink(raw: unknown): Promise<ResolveFreeScanReturnLinkResult> {
  if (typeof raw !== "string" || !TOKEN_RE.test(raw)) return { ok: false, reason: "invalid" };

  const [link] = await db
    .select({
      id: freeScanReturnLinksTable.id,
      purpose: freeScanReturnLinksTable.purpose,
      userId: freeScanReturnLinksTable.userId,
      customerId: freeScanReturnLinksTable.customerId,
      expiresAt: freeScanReturnLinksTable.expiresAt,
      revokedAt: freeScanReturnLinksTable.revokedAt,
    })
    .from(freeScanReturnLinksTable)
    .where(eq(freeScanReturnLinksTable.tokenHash, hashFreeScanReturnToken(raw)))
    .limit(1);

  if (!link || link.purpose !== FREE_SCAN_RETURN_PURPOSE) return { ok: false, reason: "invalid" };
  if (link.revokedAt || link.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const prospect = await loadEligibleFreeScanProspect(link.userId);
  if (!prospect || prospect.customerId !== link.customerId) {
    log.info({ linkId: link.id, userId: link.userId }, "free-scan return link: account is no longer an unentitled Prospect of this customer — refused");
    return { ok: false, reason: "not_applicable" };
  }

  await db
    .update(freeScanReturnLinksTable)
    .set({ lastUsedAt: new Date(), useCount: sql`${freeScanReturnLinksTable.useCount} + 1` })
    .where(and(eq(freeScanReturnLinksTable.id, link.id), gt(freeScanReturnLinksTable.expiresAt, new Date())));

  return { ok: true, userId: link.userId, customerId: link.customerId };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Mint a link for this user and email it via Exchange Online / Graph. Returns
 * false (and sends nothing) when the account is not an eligible Prospect.
 * Throws on a delivery failure so callers can choose to log or surface it.
 */
export async function issueAndEmailFreeScanReturnLink(userId: number): Promise<boolean> {
  const minted = await mintFreeScanReturnLink(userId);
  if (!minted) {
    log.info({ userId }, "free-scan return link: not an eligible Prospect — no link issued");
    return false;
  }

  const url = buildFreeScanResultsUrl(minted.token);
  const firstName = minted.prospect.name?.trim().split(/\s+/)[0] ?? "";
  const expiresOn = minted.expiresAt.toUTCString().slice(0, 16);
  const defaultBody = `
    <p>Hi ${escapeHtml(firstName) || "there"},</p>
    <p>Here is your link to the results of your free Microsoft 365 scan. Open it now or any time in the next 14 days — if the scan is still running, the page shows how far it has got.</p>
    <p style="margin:24px 0;text-align:center;">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#0A2540;color:#ffffff;text-decoration:none;font-weight:600;border-radius:8px;padding:12px 22px;">View your scan results</a>
    </p>
    <p style="color:#64748b;font-size:13px;">This link only shows your scan results. It does not sign you in to anything and cannot change your tenant. It expires on ${escapeHtml(expiresOn)}.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't run a free scan, you can ignore this email.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `;

  const { subject, bodyHtml } = await getEmailTemplateOrFallback(
    "free-scan-results-link",
    { url, firstName, expiresOn },
    "Your free Microsoft 365 scan results",
    defaultBody,
  );
  await sendEmailOrThrow(minted.prospect.email, subject, bodyHtml, { templateName: "free-scan-results-link" });
  // The token is never logged — only that a link was issued.
  log.info({ userId, customerId: minted.prospect.customerId, expiresAt: minted.expiresAt }, "free-scan return link: issued and emailed");
  return true;
}
