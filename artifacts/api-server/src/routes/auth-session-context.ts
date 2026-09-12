// artifacts/api-server/src/routes/auth-session-context.ts
//
// GET /api/auth/me/context — what the signed-in identity may do, and how to
// present it (#2459, part of #1696 — RBAC Role Model Redesign, step 4 of 5).
//
// ── Why this endpoint has to exist ──────────────────────────────────────────
//
// #2459's contract is *"every hit gets a capability-based check instead of a
// role-string comparison."* Before this landed there was nothing a UI could ask.
// #2455 built the evaluator, #2457 seeded the rows and #2458 put `requireRole`
// on top of it — but every one of those is server-internal. `/admin/rbac/*`
// (#2461) reads the model as an ADMINISTRATOR editing OTHER people's grants; it
// is `requireAdmin`-gated and answers "what may user N do", which is the wrong
// question and the wrong audience. No route answered "what may *I* do".
//
// So a UI that wanted to stop comparing role strings had nothing to compare
// against instead. That is the missing backend this endpoint is, and building it
// rather than rendering the check as unavailable is what CLAUDE.md's HARD RULE
// requires.
//
// ── This is a HINT surface, and says so in its own payload ──────────────────
//
// #1696, verbatim: *"hiding a nav item is not access control."* Nothing here
// changes what gates a request — every route keeps whatever middleware it has.
// What this fixes is the OTHER half of that sentence: a UI decision made from a
// hardcoded role string cannot drift from the server, because it now reads the
// same `*_feature_role_mapping` rows the server's own evaluator reads.
//
// That has one real consequence for failure handling. `requireRole`'s path
// (rbac-ladder.ts) answers 503 when the model is unseeded, because a gate that
// cannot read its rules must fail CLOSED. A presentation hint must do the
// opposite: `model.available: false` means "I could not read the rules", and the
// client's documented contract is to hide nothing on that answer. Hiding the
// whole UI because a table was empty would be a worse bug than showing a link
// the server would have refused anyway — and the server would still refuse it.
//
// ── Both systems, in one response ───────────────────────────────────────────
//
// #1696's architecture decision (2026-08-29, re-confirmed 2026-09-09) is two
// systems sharing one mechanism, and the real seeded data shows why that matters
// here: every live user holds roles in BOTH — user 39 is `Customer` on the
// MSP side and `Team Manager,Customer` on the customer side. A response that
// flattened them to one list would have to pick a winner for a duplicated key
// like `team.manage`, which exists in both systems as genuinely different
// authorities. So the two are returned separately and are never merged.

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { loadRbacEvaluator, type RbacSystem } from "@workspace/db/rbac";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { identityPresentation } from "../lib/identity-presentation.ts";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "auth" });

interface SystemGrants {
  /** msps.id for `msp`, tenants.id for `customer`. Null for a principal with no org. */
  orgId: number | null;
  /** Catalogued capability keys that evaluate to allowed, sorted. */
  capabilities: string[];
}

/**
 * One system's granted set, or null if the model could not be read.
 *
 * Null and `[]` are deliberately different answers. `[]` is a real evaluation
 * that granted nothing; null is "no evaluation happened", which is what the
 * `available: false` contract above is built on. Collapsing them would make an
 * unreadable model indistinguishable from a genuinely empty grant.
 */
async function grantsFor(system: RbacSystem, userId: number, orgId: number | null): Promise<SystemGrants | null> {
  try {
    const evaluator = await loadRbacEvaluator(db, { system, userId, orgId });
    return { orgId, capabilities: evaluator.grantedCapabilities() };
  } catch (err) {
    // Never fatal. A presentation hint that 500s would take the whole shell
    // down over a table the shell does not strictly need.
    log.error({ err, system, userId, orgId }, "auth/me/context: could not evaluate capabilities");
    return null;
  }
}

// ─── GET /api/auth/me/context ────────────────────────────────────────────────
//
// {
//   user: { id, email, role, mspRole },
//   presentation: { roleLabel, landingSurface },
//   model: { available: boolean },
//   capabilities: { msp: string[], customer: string[] }
// }
//
// `capabilities` is always present and always both keys, so a client never has
// to branch on shape — only on `model.available`.
router.get("/auth/me/context", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  // Read the org linkage from the `users` row rather than the JWT claim. The
  // claim is written from this column at issue time (`getMspClaims`), so they
  // agree — but a long-lived session reassigned to another MSP would carry a
  // stale claim, and resolving one org's permissions against another org's rows
  // is precisely the cross-tenant leak the redesign exists to make impossible.
  // This is a read-only presentation surface, so re-reading is free of the
  // mid-session-demotion concern that (correctly) kept #2458 on the claim.
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      mspRole: usersTable.mspRole,
      mspId: usersTable.mspId,
      tenantId: usersTable.tenantId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!row) {
    // A valid JWT for a user row that no longer exists. Real, and not a 500.
    res.status(404).json({ error: "Account no longer exists" });
    return;
  }

  const [msp, customer] = await Promise.all([
    grantsFor("msp", row.id, row.mspId),
    grantsFor("customer", row.id, row.tenantId),
  ]);

  res.json({
    user: { id: row.id, email: row.email, role: row.role, mspRole: row.mspRole },
    presentation: identityPresentation(row),
    model: { available: msp !== null && customer !== null },
    capabilities: {
      msp: msp?.capabilities ?? [],
      customer: customer?.capabilities ?? [],
    },
  });
});

export default router;
