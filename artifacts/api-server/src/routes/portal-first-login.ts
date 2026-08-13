/**
 * portal-first-login.ts
 *
 * The first-login trigger endpoint. Role-agnostic on purpose: any authenticated
 * customer landing on the portal for the first time calls this, and it fires the
 * shared first-login provisioning bundle (runFirstLoginProvisioning) for their
 * account. It is the "first login" half of the "payment OR first login, whichever
 * first" rule — the payment half already lives in portal.ts.
 *
 * The Assessment wizard calls this on mount, but nothing here is Assessment-
 * specific; a future first-login flow for another role can hit the same route.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { runFirstLoginProvisioning } from "../lib/first-login-provisioning";
import { emitWorkflowEvent } from "../lib/workflow-executor";
import { ensureLeadForEmail } from "../lib/lead-intent";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.provisioning" });

const router: IRouter = Router();

// ── POST /api/portal/first-login/provision ───────────────────────────────────
// Kick the first-login provisioning bundle for the authenticated user. Returns
// immediately (202) — provisioning is a long, fire-and-forget background job
// guarded for idempotency inside runFirstLoginProvisioning, so the caller never
// waits on it and repeated calls are safe.
router.post(
  "/portal/first-login/provision",
  requireAuth,
  (req: Request, res: Response): void => {
    const user = req.user;
    if (!user?.id) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Admin-preview (impersonation) sessions must never mutate the impersonated
    // tenant. requireAuth already blocks non-GET during impersonation, but guard
    // explicitly since provisioning creates real Graph resources.
    if (user.impersonatedBy) {
      res.status(202).json({ ok: true, provisioning: false, reason: "preview_mode" });
      return;
    }

    const displayName = user.name ?? user.email ?? `Client ${user.id}`;
    void runFirstLoginProvisioning({ userId: user.id, displayName });

    // First-login side of the Assessment/Free document-generation "wait for both"
    // gate. This endpoint firing IS the customer's first-login event. Rather than
    // calling document generation directly (the retired assessment-doc-trigger
    // path), we emit a visible workflow event: the seeded "Assessment Document
    // Generation" workflow triggers on it and its assessment_doc_gate node
    // re-checks whether the scan has already completed before generating. No-op
    // for non-assessment customers. Fire-and-forget — never blocks the 202 below.
    void emitWorkflowEvent("portal.first_login", { userId: user.id });

    // Bridge this session's identity into the CRM leads table (check-then-create
    // by email) so the Engagement Offer Engine's findLeadByEmail lookup has a
    // real row to find — a portal login alone never created one before this.
    // Role-agnostic like the rest of this handler; today only the Assessment
    // wizard calls this route, so in practice this covers Assessment-tier.
    void ensureLeadForEmail(user.email, { name: user.name, source: "portal_login" });

    log.info({ userId: user.id }, "first-login provisioning requested");

    res.status(202).json({ ok: true, provisioning: true });
  },
);

export default router;
