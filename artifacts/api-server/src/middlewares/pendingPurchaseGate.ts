/**
 * THE PENDING-PURCHASE GATE MIDDLEWARE (Git #4375, issue 5 of Feature #4370).
 *
 * Mounted once in `app.ts`, directly behind the subscription gate and ahead of the entire
 * `/api` router. The decision is `lib/pending-purchase-gate.ts`; this file is plumbing:
 * read the token, confirm the pending rung against the live row, apply the decision.
 *
 * Cost: a request whose verified token does not claim a `*Pending` rung — every operator,
 * every customer, every anonymous call — costs one JWT decode and no I/O. Only a token
 * that claims a pending rung pays for a `users` lookup, and that lookup exists so a user
 * whose consent just landed (#4370 issue 3's promote-on-consent swap) is let through
 * immediately rather than staying walled for the rest of a 15-minute token.
 *
 * FAILS CLOSED, unlike the subscription gate. That gate is a billing boundary behind
 * which `requireAuth`/`can()` still protect everything; this one IS the access boundary
 * for a principal who has not consented to anything yet. When the row cannot be read,
 * the verified token's own claim decides, and the claim says pending.
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger.ts";
import {
  evaluatePendingPurchaseGate,
  pendingPurchaseGateBody,
  pendingRoleOf,
  type PendingGatePrincipal,
} from "../lib/pending-purchase-gate.ts";

const log = logger.child({ channel: "auth" });

type TokenPrincipal = PendingGatePrincipal & { id?: number };

/** Decode and verify, without enforcing. An absent/invalid token is `requireAuth`'s 401. */
function principalFromRequest(req: Request): TokenPrincipal | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(header.slice(7), secret) as TokenPrincipal;
  } catch {
    return null;
  }
}

export function pendingPurchaseGate(req: Request, res: Response, next: NextFunction): void {
  const principal = principalFromRequest(req);
  const claimedPendingRole = pendingRoleOf(principal);

  // The overwhelmingly common case: no pending claim, no I/O.
  if (claimedPendingRole === null) {
    next();
    return;
  }

  const decide = (pendingRole: ReturnType<typeof pendingRoleOf>): void => {
    const outcome = evaluatePendingPurchaseGate({ pendingRole, method: req.method, path: req.path });
    if (!outcome.gated) {
      next();
      return;
    }
    log.info(
      { userId: principal?.id, pendingRole: outcome.pendingRole, method: req.method, path: req.path },
      "pending-purchase-gate: pending account — route resolved to the resume-purchase stub",
    );
    res.status(403).json(pendingPurchaseGateBody(outcome.pendingRole));
  };

  // Allowlisted paths and preflight never need the live row — decide on the claim.
  if (evaluatePendingPurchaseGate({ pendingRole: claimedPendingRole, method: req.method, path: req.path }).gated === false) {
    next();
    return;
  }

  const userId = principal?.id;
  if (typeof userId !== "number") {
    decide(claimedPendingRole);
    return;
  }

  void db
    .select({ role: usersTable.role, mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1)
    .then(([row]) => {
      // No row: a verified token for a user that no longer exists — keep the claim.
      decide(row ? pendingRoleOf({ role: row.role as PendingGatePrincipal["role"], mspRole: row.mspRole }) : claimedPendingRole);
    })
    .catch((err: unknown) => {
      log.error({ err, userId }, "pending-purchase-gate: live role read failed — gating on the token claim");
      decide(claimedPendingRole);
    });
}
