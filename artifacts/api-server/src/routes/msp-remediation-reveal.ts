/**
 * msp-remediation-reveal.ts — Git #2670, Feature #1684 (Remediation Tracking,
 * MSP Console). MSP-side mirror of `portal-remediation-reveal.ts` (#1541) —
 * reveal a `you_must_run` fix's script, still gated on an approved Change
 * Request. Feature #1684: "gate execution behind a CR" — the MSP operator is
 * the one who actually runs these scripts, so this route is not optional
 * scope, it is the point of the gate: the CR authorizes disclosure, not the
 * caller's role. Same authorization rule as the portal route — the script
 * never leaves the server without a cleared CR, whichever side asks.
 *
 *   POST /api/msp/customers/:customerId/remediation/fix-routes/:checkKey/reveal
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
import { resolveTenantScope } from "../lib/portal-customer-scope";
import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

interface WireRevealedFix {
  readonly checkKey: string;
  readonly changeRequestCode: string;
  readonly remediationSteps: { text: string; code?: string; language?: string }[];
  readonly prerequisites: readonly string[];
  readonly expectedOutcome: string;
  readonly validationStep: string;
  readonly validationCommand: string | null;
}

/** Same resolve+authorize idiom as msp-remediation-tracker.ts. */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

router.post(
  "/msp/customers/:customerId/remediation/fix-routes/:checkKey/reveal",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

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
          "MSP-side remediation-reveal: withheld — CR gate not satisfied",
        );
        res.status(403).json({ error: verdict.reason });
        return;
      }

      const kbByKey = await fetchPublishedKnowledgeBaseRows([checkKey]);
      const kb = kbByKey.get(checkKey);
      if (!kb) {
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
      log.error({ err, customerId, checkKey }, "POST /msp/customers/:customerId/remediation/fix-routes/:checkKey/reveal failed");
      res.status(500).json({ error: "Failed to resolve remediation reveal" });
    }
  },
);

export default router;
