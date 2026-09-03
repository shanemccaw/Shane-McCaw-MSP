/**
 * admin-testbed.ts
 *
 * Git #986 (Epic #803) — Environment-gated testbed maintenance endpoints.
 *
 * Shane's scope decision (issue #986): "this is all going to a test server,
 * there is no real data except my two test tenants. The real scope here should
 * be that NONE of these endpoints are accessible outside the dev environment.
 * ... any tenant in the dev environment as far as I am concerned is a test
 * tenant."
 *
 * So the safety model here is an ENVIRONMENT-level gate, not a per-request
 * isTestbed flag on every row: every route is structurally 403-dead unless the
 * server is running against a real Replit DEV origin (a *.replit.dev workspace
 * preview / local dev). The gate is isReplitDevEnvironment() from lib/stripe.ts
 * — the SAME REPLIT_DOMAINS check that selects sk_test_ vs sk_live_ Stripe keys,
 * deliberately reused rather than a second dev/prod detection mechanism, so the
 * two can never disagree. There is NO request parameter or header that can
 * bypass it.
 *
 * Routes (dev-origin-gated FIRST, then requireAdminOrIngestToken so the headless
 * BuildConsole test harness (#898) can reach them with BUILD_TRACKER_INGEST_TOKEN
 * exactly as #901/#965 do):
 *   POST /api/admin/testbed/reset                  — reset ONE testbed customer's
 *                                                    DB state to a known baseline
 *   POST /api/admin/testbed/teardown-graph-writes  — reverse real M365 Graph
 *                                                    writes a test run made, via
 *                                                    Launch Control's own
 *                                                    rollbackExecution() (NOT a
 *                                                    second undo mechanism)
 *   POST /api/admin/testbed/seed-signup-token       — mint a real, single-use
 *                                                    signupExchangeTokensTable
 *                                                    row for an explicit userId
 *                                                    (Git #1052), so the harness
 *                                                    can drive /auth/signup-
 *                                                    exchange's real happy path
 *                                                    without the Stripe+OAuth
 *                                                    mint wall
 *
 * Everything is logged loudly on the admin.testbed channel — what was reset /
 * torn down, from where, and an explicit record that the environment gate was
 * evaluated and which way it went — because these operations destroy state and
 * #986 requires the gate firing to be auditable.
 */

import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  tenantEngineOverridesTable,
  baselineActionTemplateAuditLogTable,
  mspsTable,
  mspSubscriptionsTable,
  mspEventStoreTable,
  servicesTable,
  usersTable,
  signupExchangeTokensTable,
  portalRunbooksTable,
  portalRunbookRunsTable,
  portalRunbookStepsTable,
  portalHoldWindowsTable,
  mspSopsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { resolveTenantScope } from "../lib/portal-customer-scope";
import { randomBytes } from "crypto";
import { requireAdminOrIngestToken, requireRole } from "../middlewares/requireAuth";
import { isReplitDevEnvironment, getStripeKey } from "../lib/stripe";
import { dispatchMspStripeEvent } from "./msp-billing-webhook";
import { handleMspDunningAdvance } from "../lib/msp-billing-nodes";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.testbed" });

const router: IRouter = Router();

/**
 * Describe where a request came from, for the audit line. Best-effort — a
 * proxied dev server may only expose some of these.
 */
function describeOrigin(req: Request): Record<string, unknown> {
  return {
    host: req.headers.host ?? null,
    ip: req.ip ?? null,
    forwardedFor: req.headers["x-forwarded-for"] ?? null,
    userId: req.user?.id ?? null,
    userEmail: req.user?.email ?? null,
    replitDomains: process.env.REPLIT_DOMAINS ?? null,
  };
}

/**
 * THE load-bearing safety gate. Structurally refuses every testbed route unless
 * the server is running against a real Replit DEV origin — regardless of any
 * request parameter, body field, or header (there is no override). Reuses
 * isReplitDevEnvironment() (lib/stripe.ts), the exact same REPLIT_DOMAINS check
 * that picks sk_test_ vs sk_live_. Logs loudly either way so the gate's decision
 * is always in the record, per #986's "confirm the environment gate fired"
 * requirement.
 */
function requireDevOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!isReplitDevEnvironment()) {
    log.warn(
      { gate: "dev-origin", gatePassed: false, path: req.path, ...describeOrigin(req) },
      "admin-testbed: environment gate BLOCKED — server is not a .replit.dev dev origin; testbed endpoint refused",
    );
    res.status(403).json({
      error:
        "Testbed endpoints are only available in the dev environment (a .replit.dev origin). This server is running as a real deployment — refused.",
      gate: "dev-origin",
    });
    return;
  }
  log.info(
    { gate: "dev-origin", gatePassed: true, path: req.path, ...describeOrigin(req) },
    "admin-testbed: environment gate PASSED — dev origin confirmed",
  );
  next();
}

// ── POST /admin/testbed/reset ─────────────────────────────────────────────────
//
// Reset ONE testbed customer's accumulated test-run state back to a known
// baseline. Takes an explicit customerId (tenants.id) — never a blind full-DB
// wipe — for precision and diagnosability, per #986 ("still take a real,
// explicit parameter identifying which testbed tenant/customer to reset").
// No per-row isTestbed filtering: the dev-origin gate above IS the safety
// boundary, and within dev "any tenant ... is a test tenant" (Shane).
//
// Baseline = this customer's simulator/test scaffolding cleared:
//   - tenant_engine_overrides       (injected Graph field overrides for sim runs)
//   - baseline_action_template_audit_log rows for this customer (the write-action
//                                    execution history recorded by test runs)
// Both are unambiguously test-run artifacts and both carry an explicit customer
// scope. The set is deliberately conservative and lives in ONE transaction here;
// extend it in place as new test-generated, customer-scoped tables are added.
//
// ORDERING vs teardown: this clears the write-action audit log that the Graph
// teardown reads. Run reset as a clean-slate BEFORE a test run, or run
// teardown-graph-writes BEFORE a post-run reset — never rely on the audit log
// surviving a reset.

router.post(
  "/admin/testbed/reset",
  requireDevOrigin,
  requireAdminOrIngestToken(),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { customerId?: number | string };
    const rawCustomerId = body?.customerId;
    const customerId =
      typeof rawCustomerId === "number" && Number.isInteger(rawCustomerId)
        ? rawCustomerId
        : typeof rawCustomerId === "string" && /^\d+$/.test(rawCustomerId.trim())
          ? parseInt(rawCustomerId.trim(), 10)
          : NaN;
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({
        error:
          "customerId (a positive integer tenants.id) is required — reset is scoped to one testbed customer, never a blind full-DB wipe",
      });
      return;
    }

    try {
      const [customer] = await db
        .select({
          id: tenantsTable.id,
          name: tenantsTable.customerName,
          tenantId: tenantsTable.tenantId,
        })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      if (!customer) {
        res.status(404).json({ error: `No tenant found with id ${customerId}` });
        return;
      }

      // The actual reset SQL — one transaction, everything scoped to this
      // customer. Written here as the endpoint's own deliverable (never run by
      // hand in a Claude session); Shane reviews the logic in code. .returning()
      // gives an exact per-table count for the audit line.
      const cleared = await db.transaction(async (tx) => {
        const engineOverrides = await tx
          .delete(tenantEngineOverridesTable)
          .where(eq(tenantEngineOverridesTable.testbedCustomerId, customerId))
          .returning({ id: tenantEngineOverridesTable.id });

        // afterSnapshot.customerId is the customer a write-action run targeted
        // (recorded by runBaselineTemplateAgainstTenant). Compare as TEXT
        // (jsonb ->> yields text) rather than ::int-casting — a cast would throw
        // the whole transaction if any row ever stored a non-numeric value
        // there, whereas a text match of the extracted value against the
        // customerId's string form is exact and cast-safe. customerId is a
        // validated integer, still passed as a bound parameter.
        const auditRows = await tx
          .delete(baselineActionTemplateAuditLogTable)
          .where(
            sql`(${baselineActionTemplateAuditLogTable.afterSnapshot} ->> 'customerId') = ${String(customerId)}`,
          )
          .returning({ id: baselineActionTemplateAuditLogTable.id });

        return {
          tenantEngineOverridesDeleted: engineOverrides.length,
          writeActionAuditRowsDeleted: auditRows.length,
        };
      });

      log.info(
        {
          action: "reset",
          gate: "dev-origin",
          gatePassed: true,
          customerId: customer.id,
          tenantId: customer.tenantId,
          customerName: customer.name,
          cleared,
          ...describeOrigin(req),
        },
        `admin-testbed: RESET testbed customer ${customer.id} (${customer.name ?? "unnamed"}) to baseline — cleared ${cleared.tenantEngineOverridesDeleted} engine override(s) + ${cleared.writeActionAuditRowsDeleted} write-action audit row(s)`,
      );

      res.json({
        reset: true,
        customer: { id: customer.id, name: customer.name, tenantId: customer.tenantId },
        cleared,
      });
    } catch (err) {
      log.error({ err, customerId }, "admin-testbed: reset failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to reset testbed state",
      });
    }
  },
);

// ── POST /admin/testbed/seed-signup-token ─────────────────────────────────────
//
// Git #1052 — mint a real, single-use signupExchangeTokensTable row for an
// explicit userId, so /auth/signup-exchange's genuine happy path (token ->
// real session via issueSessionForUser) can be driven end-to-end by the
// headless harness. The MINT path #636 built for production
// (POST /public/flow/set-password) requires a real Stripe-paid checkout
// session — unreachable here, same wall as #987's money-path-e2e.json — but
// that wall belongs to set-password, not to signup-exchange itself, which has
// no Stripe/OAuth dependency of its own. This route is a dev-only alternate
// mint path for testing that endpoint in isolation; set-password's own mint
// logic (public-assessment-account.ts) is untouched.
//
// Same discipline as /admin/testbed/reset: an explicit userId (never a blind/
// implicit target), same token-generation call site as every other
// exchange-token mint (randomBytes(32).toString("hex")), same 2-minute TTL as
// the print/document-print/signup exchange tokens.

router.post(
  "/admin/testbed/seed-signup-token",
  requireDevOrigin,
  requireAdminOrIngestToken(),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { userId?: number | string };
    const rawUserId = body?.userId;
    const userId =
      typeof rawUserId === "number" && Number.isInteger(rawUserId)
        ? rawUserId
        : typeof rawUserId === "string" && /^\d+$/.test(rawUserId.trim())
          ? parseInt(rawUserId.trim(), 10)
          : NaN;
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({
        error:
          "userId (a positive integer users.id) is required — seed-signup-token is scoped to one explicit user, never a blind/implicit target",
      });
      return;
    }

    try {
      const [user] = await db
        .select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!user) {
        res.status(404).json({ error: `No user found with id ${userId}` });
        return;
      }

      const token = randomBytes(32).toString("hex");
      await db.insert(signupExchangeTokensTable).values({
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      });

      log.info(
        {
          action: "seed-signup-token",
          gate: "dev-origin",
          gatePassed: true,
          userId: user.id,
          userEmail: user.email,
          ...describeOrigin(req),
        },
        `admin-testbed: SEEDED a signup-exchange token for user ${user.id} (${user.email})`,
      );

      res.json({ token });
    } catch (err) {
      log.error({ err, userId }, "admin-testbed: seed-signup-token failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to seed signup-exchange token",
      });
    }
  },
);

// ── POST /admin/testbed/teardown-graph-writes ─────────────────────────────────
//
// Reverse the real M365 Graph write actions a test run made against a tenant.
// This implements NO new undo logic — it reuses Launch Control's own
// rollbackExecution() (lib/workflow-executor.ts) per write: read that write's
// audit row (requestVariables + afterSnapshot), then replay the paired REVERSE
// template (self-pair boolean-invert / Teams-membership special-case), exactly
// as POST /api/msp/:mspId/launch-control/rollback/:auditLogId already does.
//
// Contract is an EXPLICIT list of auditLogIds — the writes this test run made.
// Every Launch-Control / write-action /execute response returns the auditLogId
// of the write it performed; a test run collects those and hands them back here.
// Explicit (rather than "enumerate everything for this customer") is deliberate:
// it is precise, idempotent, and avoids the ping-pong hazard of re-enumerating a
// customer whose rollback rows are themselves action:"executed" writes. Undone
// in the given order — pass them newest-first (LIFO) to unwind dependent writes.
//
// Each id is attempted independently; a not-found / not-'executed' /
// not-reversible / already-undone write is recorded as failed and skipped, never
// aborting the rest of the teardown.

router.post(
  "/admin/testbed/teardown-graph-writes",
  requireDevOrigin,
  requireAdminOrIngestToken(),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { auditLogIds?: unknown };

    if (!Array.isArray(body?.auditLogIds)) {
      res.status(400).json({
        error:
          "auditLogIds (number[]) is required — the audit-log ids of the write actions this test run made (each /execute response returns one)",
      });
      return;
    }

    const auditLogIds = body.auditLogIds
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((n) => Number.isInteger(n) && n > 0);

    if (auditLogIds.length === 0) {
      res.status(400).json({
        error: "auditLogIds contained no valid positive integers",
      });
      return;
    }

    try {
      // The one production undo path — Launch Control's reverse-template rollback.
      const { rollbackExecution } = await import("../lib/workflow-executor");

      const results: Array<{
        auditLogId: number;
        rolledBack: boolean;
        status?: number;
        rollbackAuditLogId?: number;
        reason?: string;
      }> = [];

      for (const id of auditLogIds) {
        try {
          const r = await rollbackExecution(id);
          results.push({
            auditLogId: id,
            rolledBack: r.success,
            status: r.status,
            rollbackAuditLogId: r.rollbackAuditLogId,
            reason: r.success ? undefined : r.errorType ?? "reverse call did not succeed",
          });
        } catch (itemErr) {
          // rollbackExecution throws for not-found / not-'executed' /
          // not-reversible / missing customer-tenant context — record and
          // continue, never abort the rest.
          results.push({
            auditLogId: id,
            rolledBack: false,
            reason: itemErr instanceof Error ? itemErr.message : "rollback failed",
          });
        }
      }

      const rolledBack = results.filter((r) => r.rolledBack).length;
      const failed = results.length - rolledBack;

      log.info(
        {
          action: "teardown-graph-writes",
          gate: "dev-origin",
          gatePassed: true,
          requested: auditLogIds.length,
          rolledBack,
          failed,
          results,
          ...describeOrigin(req),
        },
        `admin-testbed: TEARDOWN reversed ${rolledBack}/${auditLogIds.length} Graph write(s) via Launch Control rollbackExecution (${failed} not reversed)`,
      );

      res.json({ toreDown: true, requested: auditLogIds.length, rolledBack, failed, results });
    } catch (err) {
      log.error({ err }, "admin-testbed: teardown-graph-writes failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to tear down Graph writes",
      });
    }
  },
);

// ── POST /admin/testbed/billing-simulate ──────────────────────────────────────
//
// Drive the REAL post-purchase Stripe billing lifecycle handlers against a
// dedicated, isTestbed-flagged MSP subscription — so a test manifest can assert
// the genuine resulting DB state (msp_subscriptions / msps / msp_event_store)
// after a renewal, cancellation, failed payment + dunning advance, or refund,
// not merely that a webhook returned 200.
//
// Why this exists: Stripe billing webhooks are the money spine, but they cannot
// be exercised from the headless HTTP/WebView2 test harness the normal way — the
// harness cannot produce a valid Stripe webhook SIGNATURE, and Stripe-side event
// generation (renewals, dunning retries) is asynchronous and non-deterministic.
// So this endpoint calls the SAME dispatchMspStripeEvent() the production
// /api/msp/stripe/webhook route calls (one shared switch — see msp-billing-webhook.ts)
// with a synthetic-but-faithful event object carrying exactly the fields each
// real handler reads. The REAL handler logic and REAL DB writes run; the ONLY
// thing skipped is signature verification + Stripe's own event emission. That is
// the honest boundary, gated behind the same dev-origin wall as reset above.
//
// Actions (body.action):
//   "ensureSubscription" — idempotently upsert the testbed MSP + msp_subscription
//        to a known baseline (status=active, dunning=null, a fixed
//        stripe_subscription_id) and clear its msp_event_store rows. Also the
//        teardown: re-running it restores the clean baseline. isTestbed=true.
//   "dispatchEvent"      — { event: { type, object } } → dispatchMspStripeEvent()
//        (the real production dispatcher). No new billing logic here.
//   "advanceDunning"     — optionally back-date payment_failed_at on the testbed
//        sub by paymentFailedDaysAgo, then run the REAL handleMspDunningAdvance()
//        daily-worker node so the null→reminder_sent→suspended→access_revoked→
//        archival_flagged ladder is assertable without waiting real days.
//
// Everything is scoped to the single fixed testbed stripe_subscription_id below;
// no real customer subscription is reachable, and the dev-origin gate is the
// outer safety boundary (identical to reset).

const TESTBED_MSP_SLUG = "regression-testbed-msp";
const TESTBED_MSP_NAME = "Regression Testbed MSP (billing lifecycle)";
const TESTBED_STRIPE_SUB_ID = "sub_regression_testbed";
const TESTBED_STRIPE_CUSTOMER_ID = "cus_regression_testbed";
const TESTBED_STRIPE_PRICE_ID = "price_regression_testbed";
const TESTBED_CONTACT_EMAIL = "regression-testbed@example.com";

router.post(
  "/admin/testbed/billing-simulate",
  requireDevOrigin,
  requireAdminOrIngestToken(),
  async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    try {
      // ── ensureSubscription: upsert testbed MSP + subscription to baseline ──────
      if (action === "ensureSubscription") {
        const now = new Date();

        const [msp] = await db
          .insert(mspsTable)
          .values({
            name: TESTBED_MSP_NAME,
            slug: TESTBED_MSP_SLUG,
            status: "active",
            isTestbed: true,
            isDirectBusiness: false,
          })
          .onConflictDoUpdate({
            target: mspsTable.slug,
            set: {
              name: TESTBED_MSP_NAME,
              status: "active",
              suspendedAt: null,
              isTestbed: true,
              updatedAt: now,
            },
          })
          .returning({ id: mspsTable.id, slug: mspsTable.slug });

        if (!msp) {
          res.status(500).json({ error: "failed to upsert testbed MSP" });
          return;
        }

        // Resolve a real services.id to attach (serviceId is DB-FK-enforced).
        // Prefer an msp_monthly_subscription tier; fall back to any service.
        let [svc] = await db
          .select({ id: servicesTable.id })
          .from(servicesTable)
          .where(eq(servicesTable.fulfillmentType, "msp_monthly_subscription"))
          .orderBy(servicesTable.id)
          .limit(1);
        if (!svc) {
          [svc] = await db
            .select({ id: servicesTable.id })
            .from(servicesTable)
            .orderBy(servicesTable.id)
            .limit(1);
        }
        if (!svc) {
          res.status(500).json({
            error: "no services row exists to attach the testbed subscription to (seed the product catalog first)",
          });
          return;
        }

        const periodStart = now;
        const periodEnd = new Date(now.getTime() + 30 * 86_400_000);

        const [sub] = await db
          .insert(mspSubscriptionsTable)
          .values({
            mspId: msp.id,
            serviceId: svc.id,
            stripeCustomerId: TESTBED_STRIPE_CUSTOMER_ID,
            stripeSubscriptionId: TESTBED_STRIPE_SUB_ID,
            stripePriceId: TESTBED_STRIPE_PRICE_ID,
            status: "active",
            billingInterval: "month",
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            dunningState: null,
            paymentFailedAt: null,
            contactEmail: TESTBED_CONTACT_EMAIL,
          })
          .onConflictDoUpdate({
            target: mspSubscriptionsTable.mspId,
            set: {
              serviceId: svc.id,
              stripeCustomerId: TESTBED_STRIPE_CUSTOMER_ID,
              stripeSubscriptionId: TESTBED_STRIPE_SUB_ID,
              stripePriceId: TESTBED_STRIPE_PRICE_ID,
              status: "active",
              billingInterval: "month",
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              dunningState: null,
              paymentFailedAt: null,
              contactEmail: TESTBED_CONTACT_EMAIL,
              updatedAt: now,
            },
          })
          .returning({
            id: mspSubscriptionsTable.id,
            status: mspSubscriptionsTable.status,
            stripeSubscriptionId: mspSubscriptionsTable.stripeSubscriptionId,
          });

        // Clear this testbed MSP's event-store rows so each run's assertions
        // (e.g. "exactly one msp.subscription.canceled row") start from zero.
        const clearedEvents = await db
          .delete(mspEventStoreTable)
          .where(eq(mspEventStoreTable.mspId, msp.id))
          .returning({ id: mspEventStoreTable.id });

        log.info(
          {
            action: "billing-simulate:ensureSubscription",
            gate: "dev-origin",
            gatePassed: true,
            mspId: msp.id,
            serviceId: svc.id,
            stripeSubscriptionId: TESTBED_STRIPE_SUB_ID,
            eventsCleared: clearedEvents.length,
            ...describeOrigin(req),
          },
          `admin-testbed: billing-simulate ensureSubscription — testbed MSP ${msp.id} baseline (status=active, dunning=null), cleared ${clearedEvents.length} event-store row(s)`,
        );

        res.json({
          ok: true,
          action,
          msp: { id: msp.id, slug: msp.slug },
          serviceId: svc.id,
          subscription: sub,
          eventsCleared: clearedEvents.length,
        });
        return;
      }

      // ── dispatchEvent: run the real production dispatcher ─────────────────────
      if (action === "dispatchEvent") {
        const evt = body.event as { type?: unknown; object?: unknown } | undefined;
        if (
          !evt ||
          typeof evt.type !== "string" ||
          typeof evt.object !== "object" ||
          evt.object === null
        ) {
          res.status(400).json({
            error: "dispatchEvent requires event: { type: string, object: { ... } }",
          });
          return;
        }

        let stripeKey: string;
        try {
          stripeKey = getStripeKey();
        } catch {
          res.status(503).json({ error: "Stripe is not configured in this environment" });
          return;
        }
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeKey);

        const syntheticEvent = {
          id: "evt_testbed_sim",
          object: "event",
          type: evt.type,
          data: { object: evt.object },
        } as unknown as import("stripe").Stripe.Event;

        await dispatchMspStripeEvent(stripe, syntheticEvent);

        log.info(
          {
            action: "billing-simulate:dispatchEvent",
            gate: "dev-origin",
            gatePassed: true,
            eventType: evt.type,
            ...describeOrigin(req),
          },
          `admin-testbed: billing-simulate dispatchEvent — dispatched synthetic '${evt.type}' through the real msp-billing dispatcher`,
        );

        res.json({ ok: true, action, dispatched: true, eventType: evt.type });
        return;
      }

      // ── advanceDunning: back-date + run the real dunning-advance node ──────────
      if (action === "advanceDunning") {
        const stripeSubscriptionId =
          typeof body.stripeSubscriptionId === "string"
            ? body.stripeSubscriptionId
            : TESTBED_STRIPE_SUB_ID;

        if (body.paymentFailedDaysAgo !== undefined) {
          const daysAgo = Number(body.paymentFailedDaysAgo);
          if (!Number.isFinite(daysAgo) || daysAgo < 0) {
            res.status(400).json({ error: "paymentFailedDaysAgo must be a non-negative number" });
            return;
          }
          const backdated = new Date(Date.now() - daysAgo * 86_400_000);
          await db
            .update(mspSubscriptionsTable)
            .set({ status: "past_due", paymentFailedAt: backdated, updatedAt: new Date() })
            .where(eq(mspSubscriptionsTable.stripeSubscriptionId, stripeSubscriptionId));
        }

        const thresholds: Record<string, unknown> = {};
        for (const k of ["dayReminder", "daySuspend", "dayRevoke", "dayArchive"]) {
          if (body[k] !== undefined) thresholds[k] = body[k];
        }

        const result = await handleMspDunningAdvance(thresholds);

        const [row] = await db
          .select({
            dunningState: mspSubscriptionsTable.dunningState,
            status: mspSubscriptionsTable.status,
          })
          .from(mspSubscriptionsTable)
          .where(eq(mspSubscriptionsTable.stripeSubscriptionId, stripeSubscriptionId))
          .limit(1);

        log.info(
          {
            action: "billing-simulate:advanceDunning",
            gate: "dev-origin",
            gatePassed: true,
            stripeSubscriptionId,
            paymentFailedDaysAgo: body.paymentFailedDaysAgo ?? null,
            result,
            resultingDunningState: row?.dunningState ?? null,
            ...describeOrigin(req),
          },
          `admin-testbed: billing-simulate advanceDunning — ran real msp_dunning_advance; testbed sub dunning_state now '${row?.dunningState ?? "null"}'`,
        );

        res.json({
          ok: true,
          action,
          result,
          dunningState: row?.dunningState ?? null,
          status: row?.status ?? null,
        });
        return;
      }

      res.status(400).json({
        error:
          "unknown action — expected one of: ensureSubscription | dispatchEvent | advanceDunning",
      });
    } catch (err) {
      log.error({ err, action }, "admin-testbed: billing-simulate failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "billing-simulate failed",
      });
    }
  },
);

// ── POST /admin/testbed/seed-runbooks ─────────────────────────────────────────
//
// Seeds one testbed customer's Active Runbooks page with the design prototype's
// own four runbooks and four hold windows, so the page and its state machine can
// be exercised against real rows rather than an empty state.
//
// WHY THE OFFSETS ARE RELATIVE TO NOW, AND WHY THAT MATTERS
// ---------------------------------------------------------
// The prototype pins its clock (`HOLD_NOW = 2026-08-18T09:00:00Z`) and writes
// absolute start dates against it, which is what makes its four windows land in
// four different states. Copying those absolute dates here would mean the seeded
// windows drift into `due` within days and the test would silently stop covering
// `running`, `closing` and `early` at all — passing while asserting nothing.
//
// So each window is seeded at the OFFSET FROM NOW that reproduces the
// prototype's own state, and the four states are therefore deterministic
// whenever the seed runs:
//
//   hold-ca01     closes  1h ago   verdict signals  ->  due
//   hold-admins   closes 21h out   verdict watch    ->  closing
//   hold-guest    closes 217h out  verdict clear    ->  early   (9 days saved)
//   hold-private  closes 552h out  verdict watch    ->  running
//
// Idempotent: seeding twice replaces the previous seed for that customer rather
// than accumulating. Steps and hold windows cascade from the runbook delete.
//
// AUTH DIFFERS FROM ITS NEIGHBOURS HERE, DELIBERATELY. The other testbed
// endpoints take `requireAdminOrIngestToken()` and an explicit `customerId`,
// because they act ACROSS customers (resetting one, provisioning another). This
// one only ever seeds the CALLER'S OWN tenant, so it takes a normal customer
// session and reads `customerId` from the JWT — the body is not consulted at
// all, and there is no parameter that could point it at another tenant.
//
// That is a smaller authority than its neighbours, not a larger one, and it is
// what makes the Active Runbooks manifest self-sufficient: the harness logs in
// as the test account it already uses and seeds its own data, with no shared
// secret to configure. The dev-origin gate above is still the outer boundary,
// so none of this is reachable from a real deployment.
router.post(
  "/admin/testbed/seed-runbooks",
  requireDevOrigin,
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    // From the token, never from the body. See the note above.
    const claimed = (req.user as { customerId?: number } | undefined)?.customerId;
    const customerId = typeof claimed === "number" && !Number.isNaN(claimed) ? claimed : NaN;
    if (!Number.isFinite(customerId) || customerId <= 0) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const hours = (n: number) => new Date(Date.now() + n * 3_600_000);
    /** `startedAt` for a window of `waitDays` that should close `closesInHours` from now. */
    const startedFor = (waitDays: number, closesInHours: number) =>
      new Date(hours(closesInHours).getTime() - waitDays * 86_400_000);
    const dayString = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

    const RUNBOOKS = [
      {
        key: "gov-access-review",
        title: "Access Review SOP",
        context: "Governance · 12 access reviews are overdue",
        pillar: "governance",
        startedDaysAgo: 14,
        cycleDays: 14,
        steps: [
          "Export the current access review configuration",
          "Identify the 12 overdue reviews and their owners",
          "Notify each owner with the review link and a deadline",
          "Reassign any review whose owner has left",
        ],
        checkedThrough: 2,
      },
      {
        key: "sec-legacy-auth",
        title: "Block Legacy Authentication",
        context: "Security · IMAP/POP3 tenant-wide",
        pillar: "security",
        startedDaysAgo: 21,
        cycleDays: 21,
        steps: [
          "Inventory every account still using a legacy protocol",
          "Move the SMTP relay service account to modern auth",
          "Enable CA01 in report-only across all users",
          "Enforce CA01 and block legacy authentication",
        ],
        checkedThrough: 3,
        hold: {
          key: "hold-ca01",
          title: "CA01 in report-only — 7 day observation window",
          gates: "Gates step 4 — enforce CA01 and block legacy authentication",
          gatesStepPosition: 4,
          waitDays: 7,
          closesInHours: -1,
          verdict: "signals" as const,
          scanLine:
            "2 sign-ins would have been blocked in the last 24 hours, both from the SMTP relay service account. Enforcing today breaks scan-to-email.",
          scanSource: "Report-only sign-in logs",
          scanCadence: "hourly",
          why: "Report-only tells you what would break. Enforcing while a service account is still failing turns an observation into an outage.",
        },
      },
      {
        key: "gov-reduce-admins",
        title: "Reduce Site Admins",
        context: "Governance · Client Deliverables (SharePoint)",
        pillar: "governance",
        startedDaysAgo: 7,
        cycleDays: 21,
        steps: [
          "List every site collection administrator",
          "Agree the 2 admins to retain with the site owner",
          "Give the other 9 notice, with the date",
          "Remove all but the 2 retained admins",
        ],
        checkedThrough: 3,
        hold: {
          key: "hold-admins",
          title: "Site admin notice period — 7 days",
          gates: "Gates step 4 — remove all but the 2 retained admins",
          gatesStepPosition: 4,
          waitDays: 7,
          closesInHours: 21,
          verdict: "watch" as const,
          scanLine:
            "1 of the 9 admins being removed opened site settings yesterday. Worth a word before the window closes.",
          scanSource: "Site admin activity",
          scanCadence: "hourly",
          why: "Nine people were given notice. Removing access before the notice expires is what generates the angry ticket.",
        },
      },
      {
        key: "gov-manage-guests",
        title: "Manage Guest Access",
        context: "Governance · Vendor Onboarding Packet",
        pillar: "governance",
        startedDaysAgo: 5,
        cycleDays: 14,
        steps: [
          "Inventory all 34 guest accounts with last sign-in",
          "Ask each site owner to confirm the guests they still need",
          "Remove the invitations never accepted after 30 days",
          "Chase the owners who have not responded",
          "Remove the guests nobody confirmed",
        ],
        checkedThrough: 4,
        hold: {
          key: "hold-guest",
          title: "Guest owner confirmation — 14 day window",
          gates: "Gates step 5 — remove the guests nobody confirmed",
          gatesStepPosition: 5,
          waitDays: 14,
          closesInHours: 217,
          verdict: "clear" as const,
          scanLine:
            "No sign-in, no file access and no Teams activity from any of the 31 unconfirmed guests in 5 days. All 3 owners who intended to respond have responded.",
          scanSource: "Guest activity and owner responses",
          scanCadence: "hourly",
          why: "The window exists to catch a guest who is quietly still working. Five days of complete silence answers that as well as fourteen would.",
        },
      },
      {
        key: "gov-convert-private",
        title: "Convert Site to Private",
        context: "Governance · Client Deliverables (SharePoint)",
        pillar: "governance",
        startedDaysAgo: 7,
        cycleDays: 30,
        steps: [
          "Confirm the site is currently Public",
          "Identify every member who would lose access",
          "Notify the site owner with the conversion date",
          "Give 30 days notice to the tenant",
          "Convert the site to Private automatically",
        ],
        checkedThrough: 4,
        hold: {
          key: "hold-private",
          title: "Owner notice — 30 days before automatic conversion",
          gates: "Gates step 5 — convert the site to Private automatically",
          gatesStepPosition: 5,
          waitDays: 30,
          closesInHours: 552,
          verdict: "watch" as const,
          scanLine:
            "No owner response yet. 14 tenant members opened the site in the last week, so the conversion will be noticed when it happens.",
          scanSource: "Site access and owner mailbox",
          scanCadence: "daily",
          why: "Thirty days is the notice period in your governance policy, not a technical constraint. It can be shortened by agreement.",
        },
      },
    ];

    try {
      // Replace rather than accumulate. Steps and hold windows cascade.
      await db.delete(portalRunbooksTable).where(eq(portalRunbooksTable.customerId, customerId));
      await db.delete(portalHoldWindowsTable).where(eq(portalHoldWindowsTable.customerId, customerId));

      let runbooksSeeded = 0;
      let holdsSeeded = 0;

      for (const rb of RUNBOOKS) {
        const [inserted] = await db
          .insert(portalRunbooksTable)
          .values({
            customerId,
            runbookKey: rb.key,
            title: rb.title,
            context: rb.context,
            pillar: rb.pillar,
            startedOn: dayString(rb.startedDaysAgo),
            cycleDays: rb.cycleDays,
            status: "active",
          })
          .returning({ id: portalRunbooksTable.id });
        runbooksSeeded += 1;

        // Cycle 1 (#1557) — every seeded runbook has exactly one cycle, since
        // none of this fixture data is marked `recurring`.
        const [run] = await db
          .insert(portalRunbookRunsTable)
          .values({
            runbookId: inserted.id,
            customerId,
            cycleNumber: 1,
            startedOn: dayString(rb.startedDaysAgo),
            status: "active",
          })
          .returning({ id: portalRunbookRunsTable.id });

        await db.insert(portalRunbookStepsTable).values(
          rb.steps.map((text, i) => ({
            runId: run.id,
            position: i + 1,
            text,
            checked: i < rb.checkedThrough,
            isCustom: false,
            checkedAt: i < rb.checkedThrough ? new Date() : null,
          })),
        );

        if (rb.hold) {
          await db.insert(portalHoldWindowsTable).values({
            customerId,
            runbookId: inserted.id,
            // #1940 — every seeded window gates cycle 1, the only cycle this
            // fixture ever creates, so the run link is unambiguous here.
            runId: run.id,
            holdKey: rb.hold.key,
            title: rb.hold.title,
            gates: rb.hold.gates,
            gatesStepPosition: rb.hold.gatesStepPosition,
            pillar: rb.pillar,
            startedAt: startedFor(rb.hold.waitDays, rb.hold.closesInHours),
            waitDays: rb.hold.waitDays,
            extendedDays: 0,
            scanVerdict: rb.hold.verdict,
            scanLine: rb.hold.scanLine,
            scanSource: rb.hold.scanSource,
            scanCadence: rb.hold.scanCadence,
            scanAt: hours(-1),
            why: rb.hold.why,
          });
          holdsSeeded += 1;
        }
      }

      log.info({ customerId, runbooksSeeded, holdsSeeded }, "admin-testbed: seeded portal runbooks and hold windows");
      res.json({ ok: true, customerId, runbooksSeeded, holdsSeeded });
    } catch (err) {
      log.error({ err, customerId }, "admin-testbed: seed-runbooks failed");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── POST /api/admin/testbed/seed-sops ───────────────────────────────────────
//
// Give the SOPs Hub real content: `msp_sops` is empty for the testbed MSP, so the
// hub renders correctly but blank. This seeds a realistic library across a mix of
// categories, some runnable (a step carrying a real graphEndpoint, which is what
// makes sopRunnable() true) and some manual references.
//
// AUTH mirrors seed-runbooks: dev-origin gated + a normal customer session, and it
// resolves the caller's OWN mspId from their tenant row (never the body). SOPs are
// keyed on msp_id, so this seeds the library the caller's tenant reads.
//
// IDEMPOTENT BY UPSERT, NOT BY DELETE. Unlike seed-runbooks (which owns every
// portal_runbooks row for a customer and replaces them), msp_sops is a shared MSP
// library that may already hold real procedures — so this ONLY upserts its own
// seed keys on the (msp_id, sop_id) unique index and never deletes anything.
router.post(
  "/admin/testbed/seed-sops",
  requireDevOrigin,
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const claimed = (req.user as { customerId?: number } | undefined)?.customerId;
    const customerId = typeof claimed === "number" && !Number.isNaN(claimed) ? claimed : NaN;
    if (!Number.isFinite(customerId) || customerId <= 0) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    type SeedStep = {
      stepNumber: number;
      title: string;
      description: string;
      type: "automated" | "manual";
      status: "pending";
      graphEndpoint?: string;
    };
    type SeedSop = {
      sopId: string;
      code: string;
      title: string;
      description: string;
      category: string;
      automationType: "automated" | "hybrid" | "manual";
      estimatedMinutes: number;
      complianceTags: string[];
      workloadTags: string[];
      steps: SeedStep[];
    };

    const auto = (n: number, title: string, description: string, graphEndpoint: string): SeedStep => ({
      stepNumber: n,
      title,
      description,
      type: "automated",
      status: "pending",
      graphEndpoint,
    });
    const manual = (n: number, title: string, description: string): SeedStep => ({
      stepNumber: n,
      title,
      description,
      type: "manual",
      status: "pending",
    });

    const SEED_SOPS: SeedSop[] = [
      {
        sopId: "SOP-SEED-IAM-01",
        code: "IAM-01",
        title: "Offboard a Departing Employee",
        description: "Revoke access, disable the account and reclaim licences when someone leaves.",
        category: "Identity & Access",
        automationType: "hybrid",
        estimatedMinutes: 25,
        complianceTags: ["CIS M365 1.1.3", "NIST AC-2"],
        workloadTags: ["Entra ID", "Exchange"],
        steps: [
          auto(1, "Revoke all sign-in sessions", "Force sign-out and invalidate refresh tokens.", "POST /v1.0/users/{id}/revokeSignInSessions"),
          auto(2, "Disable the account", "Block sign-in without deleting the object.", "PATCH /v1.0/users/{id} { accountEnabled: false }"),
          auto(3, "Remove assigned licences", "Free the licences the leaver held.", "POST /v1.0/users/{id}/assignLicense"),
          manual(4, "Convert mailbox to shared", "Preserve mail without a licence, per the retention policy."),
          manual(5, "Collect and wipe devices", "Recover company-owned devices and issue a remote wipe."),
        ],
      },
      {
        sopId: "SOP-SEED-IAM-03",
        code: "IAM-03",
        title: "Block Legacy Authentication Tenant-Wide",
        description: "Stage and enforce a Conditional Access policy that blocks basic-auth clients.",
        category: "Identity & Access",
        automationType: "automated",
        estimatedMinutes: 15,
        complianceTags: ["CIS M365 1.2.1", "Essential Eight"],
        workloadTags: ["Entra ID"],
        steps: [
          auto(1, "Inventory legacy-auth sign-ins", "List accounts still using IMAP/POP/SMTP basic auth.", "GET /v1.0/auditLogs/signIns?$filter=clientAppUsed eq 'IMAP4'"),
          auto(2, "Create the CA policy in report-only", "Stage a policy blocking legacy clients, observe-only first.", "POST /v1.0/identity/conditionalAccess/policies"),
          auto(3, "Enforce the policy", "Flip the policy from report-only to enabled.", "PATCH /v1.0/identity/conditionalAccess/policies/{id} { state: enabled }"),
        ],
      },
      {
        sopId: "SOP-SEED-IR-01",
        code: "IR-01",
        title: "Respond to a Reported Phishing Email",
        description: "Triage a reported message, purge it tenant-wide and block the sender.",
        category: "Incident Response",
        automationType: "hybrid",
        estimatedMinutes: 30,
        complianceTags: ["NIST IR-4"],
        workloadTags: ["Exchange", "Defender"],
        steps: [
          manual(1, "Confirm the report", "Verify the reported message is malicious, not a false positive."),
          auto(2, "Soft-delete the message tenant-wide", "Move every copy to Deleted Items across mailboxes.", "POST /v1.0/users/{id}/messages/{messageId}/move { destinationId: 'deleteditems' }"),
          auto(3, "Block the sender", "Add the sender domain to the tenant threat indicators.", "POST /v1.0/security/tiIndicators"),
          manual(4, "Notify affected recipients", "Advise a credential reset for anyone who interacted with it."),
        ],
      },
      {
        sopId: "SOP-SEED-IR-02",
        code: "IR-02",
        title: "Contain a Compromised Mailbox",
        description: "Cut an attacker's access, remove malicious rules and restore the account safely.",
        category: "Incident Response",
        automationType: "hybrid",
        estimatedMinutes: 40,
        complianceTags: ["NIST IR-4", "CIS M365 1.1"],
        workloadTags: ["Entra ID", "Exchange"],
        steps: [
          auto(1, "Revoke sessions and reset the password", "Cut the attacker's active session immediately.", "POST /v1.0/users/{id}/revokeSignInSessions"),
          auto(2, "Remove malicious inbox rules", "Find and delete forwarding and hide-the-evidence rules.", "GET /v1.0/users/{id}/mailFolders/inbox/messageRules"),
          manual(3, "Review sent items and the audit log", "Assess what was sent or exfiltrated during the compromise."),
          manual(4, "Re-enable behind fresh MFA", "Restore access only after a new MFA registration."),
        ],
      },
      {
        sopId: "SOP-SEED-IAM-02",
        code: "IAM-02",
        title: "Onboard a New Starter",
        description: "The manual checklist for provisioning a new employee's access on day one.",
        category: "Identity & Access",
        automationType: "manual",
        estimatedMinutes: 20,
        complianceTags: ["ISO 27001 A.9"],
        workloadTags: ["Entra ID"],
        steps: [
          manual(1, "Create the account from the role template", "Use the department's standard role template."),
          manual(2, "Assign the correct licence bundle", "Match the licence set to the role."),
          manual(3, "Add to the department groups", "Membership drives access, so this is what most steps depend on."),
          manual(4, "Register MFA on first sign-in", "Walk the starter through MFA registration."),
          manual(5, "Hand over the welcome pack", "Devices, credentials and the acceptable-use policy."),
        ],
      },
      // #1560 — the lifecycle set #1552's resolution named: joiner (IAM-02, above), mover,
      // leaver (IAM-01, above), promote, demote, de-VIP. Each is wholly one procedure per
      // #1554 — no decision-making step mixed with a propagation step.
      {
        sopId: "SOP-SEED-IAM-04",
        code: "IAM-04",
        title: "Move to a New Department or Role",
        description: "Reassign directory attributes and group membership when someone changes team or role.",
        category: "Identity & Access",
        automationType: "hybrid",
        estimatedMinutes: 20,
        complianceTags: ["ISO 27001 A.9"],
        workloadTags: ["Entra ID"],
        steps: [
          auto(1, "Update job title and department", "Reflect the new role in the directory profile.", "PATCH /v1.0/users/{id} { jobTitle: '{newJobTitle}', department: '{newDepartment}' }"),
          auto(2, "Reassign the reporting manager", "Point the org chart at the new manager.", "PUT /v1.0/users/{id}/manager/$ref { '@odata.id': 'https://graph.microsoft.com/v1.0/users/{managerId}' }"),
          auto(3, "Remove from the old department group", "Drop membership tied to the previous team.", "DELETE /v1.0/groups/{oldGroupId}/members/{id}/$ref"),
          auto(4, "Add to the new department group", "Grant access tied to the new team.", "POST /v1.0/groups/{newGroupId}/members/$ref { '@odata.id': 'https://graph.microsoft.com/v1.0/directoryObjects/{id}' }"),
          manual(5, "Confirm application access matches the new role", "Some app access is granted outside group membership and needs a manual check."),
        ],
      },
      {
        sopId: "SOP-SEED-IAM-05",
        code: "IAM-05",
        title: "Promote to Elevated Access",
        description: "Grant the privileged group and directory role that come with a promotion.",
        category: "Identity & Access",
        automationType: "hybrid",
        estimatedMinutes: 20,
        complianceTags: ["CIS M365 1.1", "NIST AC-2"],
        workloadTags: ["Entra ID"],
        steps: [
          auto(1, "Add to the elevated-access security group", "Grant the privileged group tied to the new tier.", "POST /v1.0/groups/{elevatedGroupId}/members/$ref { '@odata.id': 'https://graph.microsoft.com/v1.0/directoryObjects/{id}' }"),
          auto(2, "Assign the directory role", "Grant the Entra ID role that comes with the promotion.", "POST /v1.0/roleManagement/directory/roleAssignments { principalId: '{id}', roleDefinitionId: '{roleDefinitionId}', directoryScopeId: '/' }"),
          manual(3, "Confirm MFA is enforced for the new tier", "Elevated access requires phishing-resistant MFA before it takes effect."),
          manual(4, "Notify the employee's manager", "Elevated access changes require manager awareness, not just IT record-keeping."),
        ],
      },
      {
        sopId: "SOP-SEED-IAM-06",
        code: "IAM-06",
        title: "Demote from Elevated Access",
        description: "Withdraw the privileged group and directory role granted at promotion.",
        category: "Identity & Access",
        automationType: "hybrid",
        estimatedMinutes: 20,
        complianceTags: ["CIS M365 1.1", "NIST AC-2"],
        workloadTags: ["Entra ID"],
        steps: [
          auto(1, "Remove from the elevated-access security group", "Withdraw the privileged group tied to the prior tier.", "DELETE /v1.0/groups/{elevatedGroupId}/members/{id}/$ref"),
          auto(2, "Remove the directory role assignment", "Withdraw the Entra ID role granted at promotion.", "DELETE /v1.0/roleManagement/directory/roleAssignments/{roleAssignmentId}"),
          auto(3, "Revoke active sign-in sessions", "Force re-authentication so the narrower access takes effect immediately.", "POST /v1.0/users/{id}/revokeSignInSessions"),
          manual(4, "Notify the employee's manager", "Confirm the change and the reason on record."),
        ],
      },
      {
        sopId: "SOP-SEED-IAM-07",
        code: "IAM-07",
        title: "De-VIP: Withdraw VIP Protections",
        description: "Propagate an already-recorded de-VIP decision outward — remove the elevated protections a VIP classification grants. Does not make the de-VIP decision itself; that is a \"told\" call on VIP Classifications (#1552).",
        category: "Identity & Access",
        automationType: "hybrid",
        estimatedMinutes: 15,
        complianceTags: ["NIST AC-2"],
        workloadTags: ["Entra ID"],
        steps: [
          manual(1, "Confirm the platform record already shows de-VIP", "This runbook propagates a decision already told via VIP Classifications — it does not make the decision itself."),
          auto(2, "Remove from the VIP security group", "Withdraw the group membership that grants VIP-tier protections.", "DELETE /v1.0/groups/{vipGroupId}/members/{id}/$ref"),
          auto(3, "Remove the VIP Conditional Access exclusion", "Return the account to the standard Conditional Access policy set.", "PATCH /v1.0/identity/conditionalAccess/policies/{policyId} { state: 'enabled' }"),
          manual(4, "Notify the employee's manager", "Confirm the protection tier has changed and the reason on record."),
        ],
      },
      {
        sopId: "SOP-SEED-GOV-01",
        code: "GOV-01",
        title: "Quarterly Guest Access Review",
        description: "Confirm which external guests are still needed and remove the rest.",
        category: "Governance",
        automationType: "manual",
        estimatedMinutes: 45,
        complianceTags: ["CIS M365 1.3", "ISO 27001 A.9.2"],
        workloadTags: ["Entra ID", "SharePoint"],
        steps: [
          manual(1, "Export all guest accounts with last sign-in", "The starting inventory for the review."),
          manual(2, "Ask each site owner to confirm the guests they still need", "The owners, not IT, decide who stays."),
          manual(3, "Remove invitations never accepted after 30 days", "Stale pending invites are pure risk."),
          manual(4, "Remove the guests nobody confirmed", "Only after the owner window has closed."),
        ],
      },
      {
        sopId: "SOP-SEED-DATA-01",
        code: "DATA-01",
        title: "Restore a Deleted SharePoint Site",
        description: "Recover a site from the deleted-sites retention window and verify it.",
        category: "Data Protection",
        automationType: "manual",
        estimatedMinutes: 20,
        complianceTags: ["NIST CP-9"],
        workloadTags: ["SharePoint"],
        steps: [
          manual(1, "Confirm the site is within the 93-day retention window", "Past that the restore is a support ticket, not this SOP."),
          manual(2, "Restore the site from the deleted sites list", "Use the SharePoint admin centre."),
          manual(3, "Verify permissions and content", "Confirm nothing was lost and access is correct."),
          manual(4, "Notify the site owner", "Tell them it is back and confirm they can reach it."),
        ],
      },
    ];

    try {
      const scope = await resolveTenantScope(customerId);
      if (scope === null) {
        res.status(403).json({ error: "No tenant scope for this account" });
        return;
      }

      const author = req.user?.email ?? "shane@shanemccaw.com";
      const today = new Date().toISOString().slice(0, 10);
      let sopsSeeded = 0;

      for (const s of SEED_SOPS) {
        const values = {
          mspId: scope.mspId,
          sopId: s.sopId,
          code: s.code,
          title: s.title,
          description: s.description,
          category: s.category,
          version: "v1.0",
          automationType: s.automationType,
          estimatedMinutes: s.estimatedMinutes,
          complianceTags: s.complianceTags,
          workloadTags: s.workloadTags,
          steps: s.steps,
          lastUpdatedBy: author,
          lastUpdatedAt: today,
          versionStatus: "Published / Active",
        };
        // Upsert on the (msp_id, sop_id) unique index — never a blanket delete, so
        // any real SOPs already in the shared library survive.
        await db
          .insert(mspSopsTable)
          .values(values)
          .onConflictDoUpdate({
            target: [mspSopsTable.mspId, mspSopsTable.sopId],
            set: {
              code: values.code,
              title: values.title,
              description: values.description,
              category: values.category,
              version: values.version,
              automationType: values.automationType,
              estimatedMinutes: values.estimatedMinutes,
              complianceTags: values.complianceTags,
              workloadTags: values.workloadTags,
              steps: values.steps,
              lastUpdatedBy: values.lastUpdatedBy,
              lastUpdatedAt: values.lastUpdatedAt,
              versionStatus: values.versionStatus,
            },
          });
        sopsSeeded += 1;
      }

      log.info({ customerId, mspId: scope.mspId, sopsSeeded }, "admin-testbed: seeded msp SOP library");
      res.json({ ok: true, customerId, mspId: scope.mspId, sopsSeeded });
    } catch (err) {
      log.error({ err, customerId }, "admin-testbed: seed-sops failed");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

export default router;
