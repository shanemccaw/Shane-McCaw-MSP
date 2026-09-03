/**
 * portal-settings-ownership.ts — the Settings page's Ownership / RACI
 * acceptance-gate toggle (#2162, redo of #1518).
 *
 *   GET /api/portal/settings/ownership
 *   PUT /api/portal/settings/ownership/policy
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * #1518 settled the acceptance gate itself and built it mandatory. Shane's
 * 2026-09-01 decision on #2162 changes that: enforcement is now a per-
 * customer choice — "strict" (#1518's original behaviour: every A/R cell
 * must be accepted before it counts) or "loose" (an assignment is effective
 * immediately, no acceptance step — the de facto behaviour before this gate
 * existed). This route is the wire contract for that toggle; `gateMode` is
 * read by the assign/accept/decline routes in `routes/portal-ownership.ts`
 * and the symmetric MSP-side routes in `routes/msp-ownership.ts` via the
 * shared `lib/portal-ownership-policy.ts` lookup.
 *
 * ── Scope stop ────────────────────────────────────────────────────────────
 * Wire contract only — no customer-facing page. `Design/portal/` has no
 * Ownership export yet, matching the same scope stop `routes/portal-
 * ownership.ts` already documents.
 *
 * ── Default ───────────────────────────────────────────────────────────────
 * No saved row = "loose". That is not a guess: it is the behaviour every
 * existing customer already has today (there was no gate to enforce before
 * #1518), so a customer who has never opened this toggle sees no change.
 *
 * ── Scoping ───────────────────────────────────────────────────────────────
 * `resolveCustomerId` off the JWT, identical to `portal-ownership.ts` and
 * `portal-settings-change-control.ts` — the same customer-scoped era of
 * table. Role floor `CustomerUser`, matching Ownership: configuring how
 * strictly a tenant's own RACI gate runs is a paying tenant's governance
 * decision.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, portalOwnershipPolicyTable } from "@workspace/db";

import { requireRole, type AuthUser } from "../middlewares/requireAuth";
import { resolveCustomerId } from "../lib/portal-customer-scope";
import { logger } from "../lib/logger";
import {
  DEFAULT_OWNERSHIP_GATE_MODE,
  isOwnershipGateMode,
  resolveGateMode,
} from "../lib/portal-ownership-policy";
import { listWorkloadMembership, setWorkloadTracked } from "../lib/ownership-workload-membership";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

router.get(
  "/portal/settings/ownership",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const gateMode = await resolveGateMode(customerId);
      log.info({ customerId, gateMode }, "portal ownership policy served");
      res.json({ gateMode });
    } catch (err) {
      log.error(
        { customerId, err: err instanceof Error ? err.message : String(err) },
        "portal ownership policy read failed",
      );
      res.status(500).json({ error: "Your ownership acceptance-gate setting could not be loaded." });
    }
  },
);

router.put(
  "/portal/settings/ownership/policy",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const gateMode = isOwnershipGateMode(body.gateMode) ? body.gateMode : DEFAULT_OWNERSHIP_GATE_MODE;

    try {
      await db
        .insert(portalOwnershipPolicyTable)
        .values({ customerId, gateMode })
        .onConflictDoUpdate({
          target: [portalOwnershipPolicyTable.customerId],
          set: { gateMode, updatedAt: new Date() },
        });

      log.info({ customerId, gateMode }, "portal ownership policy saved");
      res.json({ ok: true, gateMode });
    } catch (err) {
      log.error(
        { customerId, err: err instanceof Error ? err.message : String(err) },
        "portal ownership policy save failed",
      );
      res.status(500).json({ error: "Your ownership acceptance-gate setting could not be saved." });
    }
  },
);

/**
 * The per-workload RACI-MEMBERSHIP toggle (#1933). See
 * `lib/ownership-workload-membership.ts`'s header for what this is and, just
 * as importantly, what it is NOT: it does not scope scanning, findings, or
 * alerting — those keep running unchanged. It only removes a workload from
 * the RACI accountability matrix, and untracking a still-enabled workload
 * writes a real finding rather than silently opting out.
 */
router.get(
  "/portal/settings/ownership/workloads",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const workloads = await listWorkloadMembership(customerId);
      res.json({ workloads });
    } catch (err) {
      log.error(
        { customerId, err: err instanceof Error ? err.message : String(err) },
        "workload RACI-membership read failed",
      );
      res.status(500).json({ error: "Your workload RACI-membership settings could not be loaded." });
    }
  },
);

router.put(
  "/portal/settings/ownership/workloads/:key",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const workloadKey = String(req.params.key ?? "").trim();
    if (!workloadKey) {
      res.status(400).json({ error: "A workload key is required." });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.tracked !== "boolean") {
      res.status(400).json({ error: "'tracked' must be a boolean." });
      return;
    }

    const actor = req.user as AuthUser | undefined;
    try {
      const result = await setWorkloadTracked(customerId, workloadKey, body.tracked, actor?.id ?? null);
      log.info(
        { customerId, workloadKey, tracked: result.tracked, findingsCreated: result.findingsCreated.length },
        "workload RACI-membership saved",
      );
      res.json({ ok: true, workloadKey, tracked: result.tracked });
    } catch (err) {
      log.error(
        { customerId, workloadKey, err: err instanceof Error ? err.message : String(err) },
        "workload RACI-membership save failed",
      );
      res.status(500).json({ error: "Your workload RACI-membership setting could not be saved." });
    }
  },
);

export default router;
