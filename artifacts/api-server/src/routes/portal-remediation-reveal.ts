/**
 * portal-remediation-reveal.ts — reveal a `you_must_run` fix's script, gated on
 * an approved Change Request (#1541).
 *
 *   POST /api/portal/remediation/fix-routes/:checkKey/reveal
 *     — for the calling customer's tenant, resolves whether a Change Request
 *       raised for THIS check has cleared approval. If it has, returns the
 *       verified PowerShell/Graph steps and records the reveal on that CR's
 *       timeline. If it has not, 403s with why — the script never leaves the
 *       server.
 *
 * WHY THIS ISN'T PART OF `portal-remediation-fix-routes.ts`
 * ────────────────────────────────────────────────────────────
 * That route (#1539) resolves and serves the SHAPE — which of the three item
 * kinds this is, for this tenant — including the always-safe affordance data
 * (admin-centre path/URL, the validation command). None of that discloses how
 * to write to the tenant. `remediation_steps[].code` does, and #1541 is
 * explicit that it "stays behind the gate" until a CR authorizes it. Keeping
 * the gated read in its own route makes that boundary a file boundary, not a
 * conditional inside a route that is otherwise safe to call unauthenticated
 * against every check.
 *
 * SCOPE STOP: ends at the wire contract, same as #1539 — no `artifacts/portal`
 * page exists yet for this module.
 */

import { Router, type IRouter, type Request, type Response } from "express";

import { fetchPublishedKnowledgeBaseRows } from "../lib/remediation-knowledge-base";
import {
  evaluateRevealAuthorization,
  findRevealCandidates,
  recordScriptReveal,
} from "../lib/remediation-reveal-gate";
import { formatChangeRequestCode } from "../lib/portal-change-control";
import { personIdForUser } from "../lib/portal-ownership";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

/** The gated payload — everything a `you_must_run` item's copy button needs, once authorized. */
interface WireRevealedFix {
  readonly checkKey: string;
  readonly changeRequestCode: string;
  readonly remediationSteps: { text: string; code?: string; language?: string }[];
  readonly prerequisites: readonly string[];
  readonly expectedOutcome: string;
  readonly validationStep: string;
  readonly validationCommand: string | null;
}

router.post(
  "/portal/remediation/fix-routes/:checkKey/reveal",
  // Same floor as the sibling shape-resolution route (#1539) — the item itself
  // is visible at Assessment tier; what gates THIS route is the CR's own
  // approval, not a second, separate entitlement check.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const checkKey = String(req.params.checkKey ?? "").trim();
    if (!checkKey) {
      res.status(400).json({ error: "checkKey is required" });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        res.status(409).json({
          error: "This account has no connected Microsoft 365 tenant to raise a change against",
        });
        return;
      }

      const candidates = await findRevealCandidates({ mspId: scope.mspId, tenantId: scope.tenantId, checkKey });
      const verdict = evaluateRevealAuthorization(candidates);
      if (!verdict.authorized) {
        log.info(
          { customerId, checkKey, reason: verdict.reason },
          "remediation-reveal: withheld — CR gate not satisfied",
        );
        res.status(403).json({ error: verdict.reason });
        return;
      }

      const kbByKey = await fetchPublishedKnowledgeBaseRows([checkKey]);
      const kb = kbByKey.get(checkKey);
      if (!kb) {
        // The CR is genuinely approved; there is simply no verified content to
        // reveal yet (a draft-only or nonexistent KB row — see #1924). Distinct
        // from a 403: the gate passed, the content doesn't exist.
        res.status(404).json({ error: "No verified remediation content published for this check yet" });
        return;
      }

      const actorPersonId = req.user?.id ? personIdForUser(req.user.id) : null;
      const actorName = req.user?.email ?? "unknown";
      await recordScriptReveal({
        changeRequestId: verdict.changeRequestId,
        mspId: scope.mspId,
        tenantId: scope.tenantId,
        checkKey,
        actorPersonId: actorPersonId ?? "",
        actorName,
      });

      const payload: WireRevealedFix = {
        checkKey,
        changeRequestCode: formatChangeRequestCode(verdict.changeRequestId),
        remediationSteps: kb.remediationSteps,
        prerequisites: kb.prerequisites,
        expectedOutcome: kb.expectedOutcome,
        validationStep: kb.validationStep,
        validationCommand: kb.validationCommand,
      };
      res.json(payload);
    } catch (err) {
      log.error({ err, customerId, checkKey }, "POST /portal/remediation/fix-routes/:checkKey/reveal failed");
      res.status(500).json({ error: "Failed to resolve remediation reveal" });
    }
  },
);

export default router;
