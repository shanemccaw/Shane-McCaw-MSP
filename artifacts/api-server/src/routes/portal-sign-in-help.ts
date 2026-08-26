/**
 * Sign-in Help — public ShaneBot ticket creation (Git #1349).
 *
 * Backs the public /login/help page's ShaneBot. The customer is (by definition)
 * locked out and unauthenticated, so this route is intentionally PUBLIC — it
 * cannot require the session the user is trying to recover. It is rate-limited
 * per-IP to keep an open ticket-creation endpoint from being abused.
 *
 * The 4 pickable issues (with their priority + routing note) are authoritative
 * HERE, server-side — the client only sends an issueKey, never the priority or
 * copy, so a caller can't forge a P1 or rewrite the routing note.
 *
 * "Attach the last ten sign-in attempts": this platform does NOT log individual
 * sign-in attempts per-row (there is no attempt/audit table for failed logins —
 * only a running failed-attempt counter + lockout state on the user row, and the
 * user_sessions table which records SUCCESSFUL sign-ins). So what genuinely
 * attaches is the account's real recent successful sign-ins (via
 * listLoginHistory) plus its real current lockout state — never fabricated. When
 * no account matches the email, that is said honestly in the ticket body rather
 * than attaching invented history. See buildSignInContext below.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.ts";
import { listLoginHistory } from "../lib/session-tracking.ts";
import { raiseSignInHelpTicket } from "../lib/zoho-desk.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "comms.support" });

const isDev = process.env.NODE_ENV !== "production";

// Per-IP limiter — an unauthenticated ticket-creation endpoint must not be a
// spam amplifier. Generous enough for a real person retrying, tight enough that
// it can't be scripted into a flood.
const signInHelpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please email us directly and we will pick it up." },
});

// The fixed 4-issue catalog. Labels + routing notes are the design's final copy
// (Customer Portal Sign-in Help.dc.html BOT_ISSUES) — do not reword.
interface SignInHelpIssue {
  label: string;
  priority: string;
  routingNote: string;
}
const SIGN_IN_HELP_ISSUES: Record<string, SignInHelpIssue> = {
  mfa: {
    label: "Lost my authenticator, no recovery codes",
    priority: "P2",
    routingNote: "Re-enrolment needs an identity check, so we will call the number on your account.",
  },
  locked: {
    label: "Locked out and resetting did not clear it",
    priority: "P2",
    routingNote: "We will check the sign-in logs for your account and lift the lock manually.",
  },
  nocode: {
    label: "Reset codes never arrive at all",
    priority: "P3",
    routingNote: "We will confirm the address on your account and check delivery on our side.",
  },
  other: {
    label: "Something else entirely",
    priority: "P3",
    routingNote: "A human reads this one before it gets routed.",
  },
};

const EMAIL_RE = /.+@.+\..+/;

/**
 * Builds the REAL sign-in context attached to the ticket: the account's current
 * lockout state + its last 10 successful sign-ins, or an honest "no account
 * matches" note. Never fabricates history — see the module docblock on why
 * failed-attempt rows don't exist to pull from.
 */
async function buildSignInContext(email: string): Promise<string> {
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      failedLoginAttempts: usersTable.failedLoginAttempts,
      lastFailedLoginAt: usersTable.lastFailedLoginAt,
      lockedUntil: usersTable.lockedUntil,
    })
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${email}`)
    .limit(1);

  if (!user) {
    return [
      "Sign-in history: no portal account matches this email address.",
      "Nothing was attached — this may be the wrong address, or there is no account yet.",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`Account: ${user.email} (user #${user.id})`);
  lines.push(
    `Current lockout state: failedLoginAttempts=${user.failedLoginAttempts}, ` +
      `lastFailedLoginAt=${user.lastFailedLoginAt ? user.lastFailedLoginAt.toISOString() : "none"}, ` +
      `lockedUntil=${user.lockedUntil ? user.lockedUntil.toISOString() : "not locked"}`,
  );

  const history = await listLoginHistory(user.id, 10);
  if (history.length === 0) {
    lines.push("Last successful sign-ins: none on record.");
  } else {
    lines.push(`Last ${history.length} successful sign-in(s), most recent first:`);
    for (const h of history) {
      lines.push(
        `  - ${h.createdAt.toISOString()} · ${h.loginMethod} · ${h.browser} on ${h.os} · ` +
          `${h.ipAddress ?? "no ip"}${h.revoked ? " · (revoked)" : ""}`,
      );
    }
  }
  lines.push(
    "Note: individual sign-in attempts (including failed ones) are not logged " +
      "per-row on this platform — only successful sign-ins (above) plus the running " +
      "failed-attempt counter / lockout state are available (Git #1349).",
  );
  return lines.join("\n");
}

router.post("/portal/sign-in-help/ticket", signInHelpLimiter, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { email?: unknown; issueKey?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const issueKey = typeof body.issueKey === "string" ? body.issueKey : "";

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "I need a valid email address to find your account." });
  }
  const issue = SIGN_IN_HELP_ISSUES[issueKey];
  if (!issue) {
    return res.status(400).json({ error: "Pick one of the listed issues first." });
  }

  try {
    const signInContext = await buildSignInContext(email);
    const result = await raiseSignInHelpTicket({
      email,
      issueLabel: issue.label,
      priority: issue.priority,
      routingNote: issue.routingNote,
      signInContext,
    });

    return res.json({
      reference: result.reference,
      priority: result.priority,
      routingNote: result.routingNote,
      email: result.email,
    });
  } catch (err) {
    log.error({ err, issueKey }, "sign-in-help: failed to raise Zoho Desk ticket");
    return res.status(502).json({
      error: "We could not raise the ticket right now. Email us from the address on your account and we will pick it up.",
    });
  }
});

export default router;
