/**
 * public-assessment-account.ts — the inline account-creation tail of the
 * marketing site's Home-page assessment flow (#436 / #437 / #438, parent #427).
 *
 * Phase 2 ended the flow at `payment -> done`, with the done step promising
 * "we'll email you with your account details and a link to them". Shane's
 * confirmed decision is to bring account setup back INLINE and delete that
 * deferral entirely, so the buyer leaves the page with a working account rather
 * than an errand. This file is the backend for the two steps that re-appear:
 *
 *   GET  /api/public/flow/scan-telemetry          #436 — real scan results
 *   POST /api/public/flow/send-verification-code  #437 — issue + email the code
 *   POST /api/public/flow/verify-code             #437 — check the code
 *   POST /api/public/flow/set-password            #438 — complete the account
 *
 * All four are unauthenticated and keyed on the checkout-session UUID, exactly
 * like the public consent routes in consent.ts and the payment routes in
 * public-assessment-payment.ts.
 *
 * ── The ordering gate ─────────────────────────────────────────────────────────
 * Every route here requires the session to be `paid`. That is the same species
 * of server-side guarantee payment already enforces (it requires `consented`):
 * the client's step machine is a convenience, not the authority on what order
 * the flow runs in.
 *
 * ── #436: there is a real scan to report, and it is not the buyer's first ─────
 * The scan is NOT triggered here and nothing here fabricates one. The consent
 * callback fires a real `runDiagnostics()` the moment read consent lands
 * (consent.ts, "Fire-and-forget diagnostics run"), which is minutes before the
 * buyer finishes paying. So by the time this step is reached there is normally a
 * genuine `msp_diagnostic_runs` row — often already completed — with real check
 * counts and real `msp_diagnostic_findings`. /scan-telemetry reports that row
 * and those findings verbatim.
 *
 * When there is no run yet, it says so (`everScanned: false`) rather than
 * inventing progress; when the run is still going, it reports the real partial
 * counts. No score is computed here on purpose — scoring is the report
 * pipeline's job and a second, independently-derived number on this page could
 * only ever disagree with the one the customer is about to be shown.
 *
 * ── #437/#438: the account already exists; this attaches a password to it ─────
 * The users row is NOT created here. `provisionProspectAccount` creates it at
 * CONSENT time (consent.ts), deliberately, so the account is real and
 * admin-recoverable from the instant consent is granted. What has never existed
 * for these buyers is a password — `users.password_hash` is nullable and stays
 * null for a Prospect. So the job of these routes is narrow and honest: prove
 * the buyer controls the email the order was placed under, then attach a
 * bcrypt hash to the account that is already theirs.
 *
 * An account that ALREADY has a password is never overwritten (`already_set`).
 * A repeat buyer's existing credential must not be replaceable through a
 * checkout session — the recovery path for a forgotten password is
 * /auth/forgot-password, which proves control of the mailbox the same way but
 * is scoped to exactly that purpose.
 *
 * ── What this deliberately does NOT do ────────────────────────────────────────
 *  - Git #636: it now DOES auto-login the buyer. The flow runs on the
 *    marketing site; the portal is a different app with its own cookie scope,
 *    so this cannot just set a portal session cookie here — it mints a
 *    single-use signupExchangeTokensTable token and appends it to the
 *    returned portalUrl as ?signupToken=..., which the portal's own boot
 *    effect (auth-context.tsx) exchanges (POST /auth/signup-exchange) for a
 *    real session the moment that tab loads. Same cross-app handoff shape as
 *    the existing impersonation_token/printToken/docPrintToken tokens, not an
 *    improvised new mechanism.
 *  - It does not promote the Prospect's role or run paid provisioning. Those
 *    remain the known gap already documented in public-assessment-payment.ts.
 *  - It does not enrol MFA. #439 is deliberately a separate, final
 *    pre-deployment build so that development test runs are not gated behind
 *    an MFA enrolment on every refresh.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "crypto";
import {
  db,
  checkoutSessionsTable,
  checkoutEmailVerificationsTable,
  tenantsTable,
  usersTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  signupExchangeTokensTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../lib/audit.ts";
import { getEmailTemplateOrFallback, sendEmailOrThrow } from "../lib/mailer.ts";
import { getMspPortalLandingUrl } from "../lib/portal-url.ts";
import { logger } from "../lib/logger.ts";

// Account creation, email-proof-of-control and credential storage are all `auth`
// on the locked channel taxonomy. The scan-telemetry read is the one thing here
// that is not — it reports on a monitor/diagnostics run, so it logs under the
// existing `engine.monitor` leaf rather than inventing a new one.
const log = logger.child({ channel: "auth" });
const scanLog = logger.child({ channel: "engine.monitor" });

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Long enough to find the mail and type it, short enough to be worth little if leaked. */
const CODE_TTL_MS = 15 * 60 * 1000;
/** Six digits is a 1-in-a-million guess — only safe with a hard cap on tries. */
const MAX_CODE_ATTEMPTS = 5;
const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;

const isDev = process.env.NODE_ENV !== "production";

// Sending mail costs money and lands in someone's inbox — the resend button is
// the abusable surface here, so it is limited harder than the check.
const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many verification emails requested. Please wait a few minutes and try again." },
});

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 200 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

const setPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

// ── Session resolution ────────────────────────────────────────────────────────

interface PaidSession {
  id: string;
  email: string;
  fullName: string;
  company: string | null;
  tenantId: string | null;
}

/**
 * The session an account-creation route may act on: unexpired, and already
 * `paid`. Anything earlier in the flow has no business reaching these steps, and
 * enforcing that here rather than only in the client's step machine is what
 * makes the ordering real.
 */
async function resolvePaidSession(rawSessionId: unknown, res: Response): Promise<PaidSession | null> {
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : "";
  if (!UUID_RE.test(sessionId)) {
    res.status(400).json({ error: "session_invalid" });
    return null;
  }

  const [row] = await db
    .select({
      id: checkoutSessionsTable.id,
      status: checkoutSessionsTable.status,
      email: checkoutSessionsTable.email,
      fullName: checkoutSessionsTable.fullName,
      company: checkoutSessionsTable.company,
      tenantId: checkoutSessionsTable.tenantId,
    })
    .from(checkoutSessionsTable)
    .where(
      and(
        eq(checkoutSessionsTable.id, sessionId),
        gte(checkoutSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "session_expired" });
    return null;
  }
  if (row.status !== "paid") {
    res.status(409).json({ error: "payment_required" });
    return null;
  }

  return { id: row.id, email: row.email, fullName: row.fullName, company: row.company, tenantId: row.tenantId };
}

// ── GET /api/public/flow/scan-telemetry (#436) ─────────────────────────────────
//
// The buyer's OWN scan, as it actually stands. Every number below is read from
// the run the consent callback started; nothing is derived, estimated or filled
// in. The three states this can honestly be in are all representable:
//
//   everScanned:false          — no run row yet (consent landed seconds ago, or
//                                the fire-and-forget run failed to start)
//   run.active:true            — running now, with real partial counts
//   run.active:false           — finished, with its real terminal counts
//
// No PII and no evidence bodies: check labels, finding titles and severities
// only, which is what the buyer is about to be shown in their own report anyway.

router.get("/public/flow/scan-telemetry", async (req: Request, res: Response) => {
  const session = await resolvePaidSession(req.query.sessionId, res);
  if (!session) return;

  const tenantGuid = session.tenantId?.trim();
  if (!tenantGuid) {
    // Paid but no tenant GUID — consent never stamped one. Reportable, not an error.
    res.json({ everScanned: false, tenantConnected: false, run: null, severityCounts: null, topFindings: [] });
    return;
  }

  try {
    const [tenant] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.tenantId, tenantGuid))
      .limit(1);

    if (!tenant) {
      scanLog.warn({ sessionId: session.id, tenantGuid }, "flow scan-telemetry: session names a tenant with no tenants row");
      res.json({ everScanned: false, tenantConnected: false, run: null, severityCounts: null, topFindings: [] });
      return;
    }

    const [latestRun] = await db
      .select({
        runId: mspDiagnosticRunsTable.runId,
        status: mspDiagnosticRunsTable.status,
        packageKey: mspDiagnosticRunsTable.packageKey,
        checksTotal: mspDiagnosticRunsTable.checksTotal,
        checksOk: mspDiagnosticRunsTable.checksOk,
        checksError: mspDiagnosticRunsTable.checksError,
        checksLicenseGap: mspDiagnosticRunsTable.checksLicenseGap,
        startedAt: mspDiagnosticRunsTable.startedAt,
        completedAt: mspDiagnosticRunsTable.completedAt,
        createdAt: mspDiagnosticRunsTable.createdAt,
      })
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.customerId, tenant.id))
      .orderBy(desc(mspDiagnosticRunsTable.createdAt))
      .limit(1);

    if (!latestRun) {
      res.json({ everScanned: false, tenantConnected: true, run: null, severityCounts: null, topFindings: [] });
      return;
    }

    // Severity mix of the findings THIS run produced. Grouped in the database
    // rather than counted in JS so a large run does not stream every row back
    // just to be tallied.
    const severityRows = await db
      .select({
        severity: mspDiagnosticFindingsTable.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(mspDiagnosticFindingsTable)
      .where(eq(mspDiagnosticFindingsTable.runId, latestRun.runId))
      .groupBy(mspDiagnosticFindingsTable.severity);

    const severityCounts = { critical: 0, warning: 0, info: 0, ok: 0 };
    for (const row of severityRows) {
      if (row.severity in severityCounts) {
        severityCounts[row.severity as keyof typeof severityCounts] = row.count;
      }
    }

    // A short, real sample — the actual finding titles, worst first. `title` is
    // the severity_rules label the pipeline resolved (#408), not a generic
    // placeholder, so these are the same words the report will use.
    const topFindings = await db
      .select({
        checkLabel: mspDiagnosticFindingsTable.checkLabel,
        severity: mspDiagnosticFindingsTable.severity,
        title: mspDiagnosticFindingsTable.title,
      })
      .from(mspDiagnosticFindingsTable)
      .where(
        and(
          eq(mspDiagnosticFindingsTable.runId, latestRun.runId),
          sql`${mspDiagnosticFindingsTable.severity} IN ('critical','warning')`,
        ),
      )
      .orderBy(sql`CASE ${mspDiagnosticFindingsTable.severity} WHEN 'critical' THEN 0 ELSE 1 END`, desc(mspDiagnosticFindingsTable.id))
      .limit(5);

    const active = (ACTIVE_RUN_STATUSES as readonly string[]).includes(latestRun.status);

    res.json({
      everScanned: true,
      tenantConnected: true,
      run: {
        status: latestRun.status,
        active,
        packageKey: latestRun.packageKey,
        checksTotal: latestRun.checksTotal ?? 0,
        checksOk: latestRun.checksOk ?? 0,
        checksError: latestRun.checksError ?? 0,
        checksLicenseGap: latestRun.checksLicenseGap ?? 0,
        startedAt: latestRun.startedAt ?? latestRun.createdAt,
        completedAt: latestRun.completedAt ?? null,
      },
      severityCounts,
      topFindings,
    });
  } catch (err) {
    scanLog.error({ err, sessionId: session.id }, "flow scan-telemetry: read failed");
    res.status(500).json({ error: "scan_telemetry_failed" });
  }
});

// ── POST /api/public/flow/send-verification-code (#437) ────────────────────────
//
// Issues a fresh six-digit code and mails it. Every previously-issued unverified
// code for this session is destroyed first, so a resend genuinely supersedes
// rather than leaving several live codes for the same address.
//
// Transport is Exchange Online / Microsoft Graph via mailer.ts's
// sendEmailOrThrow — the ONLY mail transport this platform uses. Throwing (not
// the fire-and-forget sendEmail) is deliberate: the buyer is sitting on a screen
// waiting for this mail, so a send failure has to become a visible error rather
// than a silent wait for something that will never arrive.

const sendCodeSchema = z.object({ sessionId: z.string() });

function generateSixDigitCode(): string {
  // CSPRNG, not Math.random — this is a credential, however short-lived.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

router.post("/public/flow/send-verification-code", sendCodeLimiter, async (req: Request, res: Response) => {
  const parsed = sendCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const session = await resolvePaidSession(parsed.data.sessionId, res);
  if (!session) return;

  const email = session.email.trim().toLowerCase();
  if (!email) {
    log.error({ sessionId: session.id }, "flow verification: paid session carries no email — cannot issue a code");
    res.status(409).json({ error: "email_missing" });
    return;
  }

  const code = generateSixDigitCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  try {
    // Supersede, don't accumulate: an already-verified row is left alone so the
    // password step can still see that this session's email was proven.
    await db
      .delete(checkoutEmailVerificationsTable)
      .where(
        and(
          eq(checkoutEmailVerificationsTable.sessionId, session.id),
          isNull(checkoutEmailVerificationsTable.verifiedAt),
        ),
      );

    await db.insert(checkoutEmailVerificationsTable).values({
      sessionId: session.id,
      email,
      codeHash,
      expiresAt,
    });
  } catch (err) {
    log.error({ err, sessionId: session.id }, "flow verification: could not store the verification code");
    res.status(500).json({ error: "code_issue_failed" });
    return;
  }

  const firstName = session.fullName?.trim().split(/\s+/)[0] ?? "";
  const defaultBody = `
    <p>Hi ${firstName || "there"},</p>
    <p>Here is the code to confirm your email address and finish setting up your Shane McCaw Consulting account:</p>
    <p style="margin:24px 0;text-align:center;">
      <span style="display:inline-block;font-family:Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#0A2540;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px 24px;">${code}</span>
    </p>
    <p>Enter it on the page you already have open. The code expires in <strong>15 minutes</strong>.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't just purchase a Copilot Readiness Assessment, you can ignore this email — no account changes have been made.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `;

  try {
    const { subject, bodyHtml } = await getEmailTemplateOrFallback(
      "assessment-flow-verification-code",
      { code, firstName, company: session.company ?? "" },
      "Your verification code",
      defaultBody,
    );
    await sendEmailOrThrow(email, subject, bodyHtml, { templateName: "assessment-flow-verification-code" });
  } catch (err) {
    log.error({ err, sessionId: session.id }, "flow verification: code email could not be delivered");
    res.status(502).json({ error: "email_send_failed" });
    return;
  }

  await createAuditLog({
    actorUserId: null,
    actorName: "public:assessment-flow",
    actorRole: "client",
    actionType: "assessment_flow_verification_code_sent",
    entityType: "checkout_session",
    entityId: session.id,
    // The code itself is never logged or audited — only that one was issued.
    metadata: { expiresAt },
  });

  log.info({ sessionId: session.id }, "flow verification: six-digit code issued and emailed");
  res.json({ ok: true, expiresAt: expiresAt.toISOString(), email: maskEmail(email) });
});

/** `s****e@company.com` — enough for the buyer to recognise the address, not enough to harvest it. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}@${domain}`;
}

// ── POST /api/public/flow/verify-code (#437) ───────────────────────────────────
//
// Checks the code against the newest live row for this session. Attempts are
// counted on the row, not just per-IP, so the budget follows the issued code
// rather than the network path the guesses arrive from.

const verifyCodeSchema = z.object({
  sessionId: z.string(),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code from your email"),
});

router.post("/public/flow/verify-code", verifyCodeLimiter, async (req: Request, res: Response) => {
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const session = await resolvePaidSession(parsed.data.sessionId, res);
  if (!session) return;

  const [record] = await db
    .select()
    .from(checkoutEmailVerificationsTable)
    .where(eq(checkoutEmailVerificationsTable.sessionId, session.id))
    .orderBy(desc(checkoutEmailVerificationsTable.id))
    .limit(1);

  if (!record) {
    res.status(400).json({ error: "no_code_issued" });
    return;
  }

  // Already proven — replaying the same code is a no-op, not a failure. A
  // double-submit or a back-button must not strand a buyer who is already past
  // this step.
  if (record.verifiedAt) {
    res.json({ ok: true, alreadyVerified: true });
    return;
  }

  if (record.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "code_expired" });
    return;
  }

  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    log.warn({ sessionId: session.id }, "flow verification: attempt budget exhausted for this code");
    res.status(429).json({ error: "too_many_attempts" });
    return;
  }

  // Count the attempt BEFORE judging it, so a crash between compare and
  // increment can never hand out a free guess.
  await db
    .update(checkoutEmailVerificationsTable)
    .set({ attempts: record.attempts + 1 })
    .where(eq(checkoutEmailVerificationsTable.id, record.id));

  const matches = await bcrypt.compare(parsed.data.code, record.codeHash);
  if (!matches) {
    const remaining = Math.max(0, MAX_CODE_ATTEMPTS - (record.attempts + 1));
    res.status(400).json({ error: "code_incorrect", attemptsRemaining: remaining });
    return;
  }

  await db
    .update(checkoutEmailVerificationsTable)
    .set({ verifiedAt: new Date() })
    .where(eq(checkoutEmailVerificationsTable.id, record.id));

  await createAuditLog({
    actorUserId: null,
    actorName: "public:assessment-flow",
    actorRole: "client",
    actionType: "assessment_flow_email_verified",
    entityType: "checkout_session",
    entityId: session.id,
    metadata: { attempts: record.attempts + 1 },
  });

  log.info({ sessionId: session.id }, "flow verification: email address proven");
  res.json({ ok: true });
});

// ── POST /api/public/flow/set-password (#438) ──────────────────────────────────
//
// Attaches a bcrypt hash to the account that already exists for this buyer.
// Requires a verified code for this session AND that the verified address is
// still the session's own address, so a code proven against one mailbox can
// never complete an account under another.

const setPasswordSchema = z.object({
  sessionId: z.string(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

router.post("/public/flow/set-password", setPasswordLimiter, async (req: Request, res: Response) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const session = await resolvePaidSession(parsed.data.sessionId, res);
  if (!session) return;

  const email = session.email.trim().toLowerCase();

  const [verified] = await db
    .select({ id: checkoutEmailVerificationsTable.id, email: checkoutEmailVerificationsTable.email })
    .from(checkoutEmailVerificationsTable)
    .where(
      and(
        eq(checkoutEmailVerificationsTable.sessionId, session.id),
        sql`${checkoutEmailVerificationsTable.verifiedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(checkoutEmailVerificationsTable.id))
    .limit(1);

  if (!verified) {
    res.status(409).json({ error: "email_not_verified" });
    return;
  }
  if (verified.email !== email) {
    log.warn(
      { sessionId: session.id },
      "flow set-password: REFUSED — the verified address is not the session's current address",
    );
    res.status(409).json({ error: "email_not_verified" });
    return;
  }

  // The account was created at consent time by provisionProspectAccount. If it
  // is missing, something upstream failed — that is a real defect to shout
  // about, not something to paper over by minting a second account here from a
  // different door.
  const [user] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    log.error(
      { sessionId: session.id },
      "flow set-password: no users row for a paid, email-verified buyer — consent-time Prospect provisioning did not happen",
    );
    res.status(409).json({ error: "account_missing" });
    return;
  }

  if (user.passwordHash) {
    // A returning buyer. Their existing credential is not replaceable through a
    // checkout session — /auth/forgot-password is the door for that.
    log.info({ sessionId: session.id, userId: user.id }, "flow set-password: account already has a password — sign-in required");
    res.status(409).json({ error: "already_set", portalUrl: getMspPortalLandingUrl() });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));

  await createAuditLog({
    actorUserId: user.id,
    actorName: "public:assessment-flow",
    actorRole: "client",
    actionType: "assessment_flow_password_set",
    entityType: "user",
    entityId: String(user.id),
    metadata: { checkoutSessionId: session.id },
  });

  // Git #636 — mint a single-use, short-lived token (same 2-minute TTL as
  // the print/document-print exchange tokens: comfortably longer than the
  // redirect from this response to the portal tab loading, far shorter than
  // any real session) so the portal's own boot effect can trade it for a
  // real session the instant that tab lands — no separate manual login step
  // right after the buyer has just proven their identity by setting a real
  // password.
  const signupToken = randomBytes(32).toString("hex");
  await db.insert(signupExchangeTokensTable).values({
    token: signupToken,
    userId: user.id,
    expiresAt: new Date(Date.now() + 2 * 60 * 1000),
  });

  log.info({ sessionId: session.id, userId: user.id }, "flow set-password: account completed inline");
  res.json({
    ok: true,
    email,
    portalUrl: `${getMspPortalLandingUrl()}?signupToken=${encodeURIComponent(signupToken)}`,
  });
});

export default router;
