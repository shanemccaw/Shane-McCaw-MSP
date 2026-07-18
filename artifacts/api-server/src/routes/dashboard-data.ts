/**
 * dashboard-data.ts
 *
 * Phase 7 — the data endpoint the Phase 2 rendering engine will call to fill a
 * dashboard canvas with real metric values.
 *
 * ── Endpoint ──────────────────────────────────────────────────────────────────
 *   POST /api/dashboard/resolve
 *
 *   Body: {
 *     metrics: string[]         // MetricDef.key values to resolve (required, 1..200)
 *     customerId?: number       // required for MSPOperator resolving customer-scope
 *                               // metrics; ignored/validated for CustomerUser
 *     windowDays?: number       // look-back for trend/heatmap/timeline + Smart
 *                               // history (default 30)
 *     includeHistory?: string[] // Step 5 (Smart widget state): a SUBSET of
 *                               // `metrics` for which the ok result should also
 *                               // carry `history: { t, value }[]` (oldest→newest).
 *                               // The Smart renderer needs recent history for its
 *                               // sparkline + stateless hysteresis; other renderers
 *                               // don't, so history is opt-in per metric to avoid
 *                               // the extra query for the common case. Keys not in
 *                               // this list resolve exactly as before — no `history`
 *                               // field, no extra query — so the default response is
 *                               // unchanged and this addition is backward compatible.
 *   }
 *
 *   Response 200: {
 *     scope: { role, mspId, customerId | null },
 *     results: Record<metricKey, MetricResult>   // keyed by metric key; an
 *                                                // opted-in ok result additionally
 *                                                // carries `history` when a series exists
 *   }
 *
 * A single call resolves many metrics in one round-trip so a 20-widget canvas
 * costs one request, not twenty. Each metric resolves independently — one failing
 * metric returns { status: "error", ... } for that key only and never fails the
 * batch. Unknown metric keys return { status: "error", error: "unknown metric" }.
 *
 * ── Auth & scope (no customer picker) ─────────────────────────────────────────
 *   requireRole("CustomerUser") admits CustomerUser and every higher MSP role.
 *
 *   CustomerUser  → customer-scope metrics resolve against their own
 *                   req.user.customerId. A mismatching body.customerId is rejected.
 *   MSPOperator+  → customer-scope metrics require an explicit body.customerId,
 *                   verified to belong to the caller's mspId via assertCustomerAccess
 *                   (cross-MSP access → 403). MSP-scope metrics aggregate across
 *                   req.user.mspId.
 *
 * MetricResult shapes and per-sourceType resolution live in
 * ../lib/dashboard-resolvers.ts.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { getMetric } from "@workspace/dashboard-registry";
import { resolveMetric, resolveMetricHistory, type MetricResult, type ResolveContext } from "../lib/dashboard-resolvers.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

const MAX_METRICS_PER_REQUEST = 200;

router.post(
  "/dashboard/resolve",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const body = (req.body ?? {}) as { metrics?: unknown; customerId?: unknown; windowDays?: unknown; includeHistory?: unknown };

    // ── Validate metric keys ──
    if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
      res.status(400).json({ error: "`metrics` must be a non-empty array of metric keys" });
      return;
    }
    if (body.metrics.length > MAX_METRICS_PER_REQUEST) {
      res.status(400).json({ error: `Too many metrics requested (max ${MAX_METRICS_PER_REQUEST})` });
      return;
    }
    const metricKeys = body.metrics.filter((m): m is string => typeof m === "string");

    // Opt-in subset for Smart-widget history. Restricted to keys that were also
    // requested in `metrics` — asking for history on a metric you didn't resolve
    // is meaningless.
    const requestedKeys = new Set(metricKeys);
    const includeHistory = new Set(
      Array.isArray(body.includeHistory)
        ? body.includeHistory.filter((m): m is string => typeof m === "string" && requestedKeys.has(m))
        : [],
    );

    const windowDays =
      typeof body.windowDays === "number" && body.windowDays > 0 && body.windowDays <= 365
        ? Math.floor(body.windowDays)
        : undefined;

    // ── Resolve scope ──
    const effectiveRole = user.role === "admin" ? "PlatformAdmin" : user.mspRole;
    const isCustomerUser = effectiveRole === "CustomerUser" || effectiveRole === "Free";
    const mspId = user.mspId;

    if (mspId == null) {
      res.status(400).json({ error: "No MSP association on this session" });
      return;
    }

    // Determine the customer context (integer msp_customers.id) this request resolves
    // customer-scope metrics against, if any.
    let customerId: number | undefined;

    if (isCustomerUser) {
      // A customer resolves only their own data. Reject an attempt to name another customer.
      customerId = user.customerId;
      const requested = typeof body.customerId === "number" ? body.customerId : undefined;
      if (requested != null && requested !== customerId) {
        res.status(403).json({ error: "You may only resolve metrics for your own account" });
        return;
      }
      if (customerId == null) {
        // A customer with no customer association can still get msp-scope-free results,
        // but customer-scope metrics will resolve to not_available downstream.
        log.warn({ userId: user.id }, "dashboard: CustomerUser has no customerId claim");
      }
    } else {
      // MSPOperator / MSPAdmin / PlatformAdmin — customerId comes from the request and
      // must be ownership-verified. It's optional: a request for only msp-scope metrics
      // needs none.
      const requested = typeof body.customerId === "number" ? body.customerId : undefined;
      if (requested != null) {
        const owns = await assertCustomerAccess(user, requested);
        if (!owns) {
          res.status(403).json({ error: "Access to this customer is not permitted" });
          return;
        }
        customerId = requested;
      }
    }

    const ctx: ResolveContext = {
      mspId,
      ...(customerId != null ? { customerId } : {}),
      ...(windowDays != null ? { windowDays } : {}),
    };

    log.info(
      { role: effectiveRole, mspId, customerId: customerId ?? null, metricCount: metricKeys.length, metrics: metricKeys },
      "dashboard: resolve request received",
    );

    // ── Resolve each metric independently ──
    const results: Record<string, MetricResult> = {};

    await Promise.all(
      metricKeys.map(async (key) => {
        const def = getMetric(key);
        if (!def) {
          results[key] = { metricKey: key, status: "error", error: "unknown metric key" };
          log.warn({ metricKey: key }, "dashboard: unknown metric key requested");
          return;
        }
        // Guard: a customer must never reach an msp-scope metric that aggregates the
        // whole book. Those are operator-facing.
        if (def.scope === "msp" && isCustomerUser) {
          results[key] = { metricKey: key, status: "not_available", reason: "scope_forbidden", detail: "msp-scope metric not available to customer" };
          return;
        }
        const result = await resolveMetric(def, ctx);
        // Attach Smart-widget history only when opted-in AND the metric resolved
        // ok. A history fetch never fails the metric — resolveMetricHistory
        // swallows its own errors and returns null.
        if (result.status === "ok" && includeHistory.has(key)) {
          const history = await resolveMetricHistory(def, ctx);
          if (history) result.history = history;
        }
        results[key] = result;
      }),
    );

    res.json({
      scope: { role: effectiveRole, mspId, customerId: customerId ?? null },
      results,
    });
  },
);

export default router;
