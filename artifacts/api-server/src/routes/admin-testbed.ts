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
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAdminOrIngestToken } from "../middlewares/requireAuth";
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
    const body = req.body as { customerId?: number };
    const customerId =
      typeof body?.customerId === "number" && Number.isInteger(body.customerId)
        ? body.customerId
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

export default router;
