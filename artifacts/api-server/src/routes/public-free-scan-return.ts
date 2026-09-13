/**
 * public-free-scan-return.ts — Git #1359 (Phase 7 of Feature #1352, Free Scan).
 *
 *   POST /api/public/free-scan/return-link   — email me my results link again
 *   POST /api/public/free-scan/results       — the results a return link unlocks
 *
 * Both are unauthenticated on purpose. The Free Scan Prospect has no password and
 * no entitlement, and per the #1352 decision must NOT be given a portal session
 * (see lib/free-scan-return-link.ts for why /setup-password is off-limits, #656).
 *
 * The results route is a read of ONE customer's scan summary, authorised by the
 * return-link token alone. It never sets a cookie, never returns a JWT or any
 * other credential, and never returns the account's email. The token is taken
 * from the JSON body — not the query string, not Authorization — so it is not
 * written to access logs and is never mistaken for a bearer token by any
 * middleware.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, usersTable, tenantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { issueAndEmailFreeScanReturnLink, resolveFreeScanReturnLink } from "../lib/free-scan-return-link.ts";
import { readCustomerScanTelemetry } from "../lib/customer-scan-telemetry.ts";
import { ensureProspectFreeScanBackstop } from "../lib/prospect-free-scan-backstop.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

const isDev = process.env.NODE_ENV !== "production";

// Every request can put a mail in someone's inbox, so this is the tight one.
const requestLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

// The results page polls while a scan is still running; guessing a 256-bit
// token is not the threat, so this only bounds abuse.
const resultsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 1000 : 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

// ── POST /api/public/free-scan/return-link ───────────────────────────────────
// Always answers the same way whether or not the address belongs to an eligible
// Prospect, and does the lookup + send after responding, so neither the body nor
// the response time says whether an account exists.

const requestLinkSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

router.post("/public/free-scan/return-link", requestLinkLimiter, noStore, (req: Request, res: Response) => {
  const parsed = requestLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "email_invalid" });
    return;
  }
  const email = parsed.data.email;
  res.status(202).json({ ok: true });

  void (async () => {
    try {
      const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(sql`lower(${usersTable.email})`, email))
        .limit(1);
      if (!user) return;
      const sent = await issueAndEmailFreeScanReturnLink(user.id);
      if (sent) {
        await createAuditLog({
          actorUserId: null,
          actorName: "public:free-scan",
          actorRole: "client",
          actionType: "free_scan_return_link_sent",
          entityType: "user",
          entityId: String(user.id),
          metadata: { trigger: "requested" },
        });
      }
    } catch (err) {
      log.error({ err }, "free-scan return link: re-send request failed");
    }
  })();
});

// ── POST /api/public/free-scan/results ───────────────────────────────────────

const resultsSchema = z.object({ token: z.string().max(200) });

router.post("/public/free-scan/results", resultsLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = resultsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "link_invalid" });
    return;
  }

  try {
    const resolved = await resolveFreeScanReturnLink(parsed.data.token);
    if (!resolved.ok) {
      const status = resolved.reason === "invalid" ? 401 : resolved.reason === "expired" ? 410 : 403;
      res.status(status).json({ error: `link_${resolved.reason}` });
      return;
    }

    // Phase 4's backstop (#3946): if the consent-time scan never landed a run
    // row, start one now so the page shows a real scan in progress instead of
    // nothing. Idempotent; the scan itself is fire-and-forget.
    await ensureProspectFreeScanBackstop(resolved.customerId).catch((err: unknown) =>
      log.warn({ err, customerId: resolved.customerId }, "free-scan results: backstop check failed (non-fatal)"),
    );

    const [tenant] = await db
      .select({ customerName: tenantsTable.customerName })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, resolved.customerId))
      .limit(1);

    const telemetry = await readCustomerScanTelemetry(resolved.customerId);
    res.json({ company: tenant?.customerName ?? null, ...telemetry });
  } catch (err) {
    log.error({ err }, "free-scan results: read failed");
    res.status(500).json({ error: "results_failed" });
  }
});

export default router;
