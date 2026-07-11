import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, mspCustomersTable, type MspRole } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export interface AuthUser {
  id: number;
  email: string;
  name?: string;
  role: "admin" | "client";
  impersonatedBy?: number;
  /**
   * When this session is an impersonation, this is the target user's mspId.
   * Any AI-dependent action taken during this session must be billed to this
   * MSP's balance — never to the actor's MSP or left unattributed.
   */
  impersonatedMspId?: number;
  // MSP extended claims — present when the user has an msp_users row
  mspRole?: MspRole;
  mspId?: number;
  customerId?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ── MSP role hierarchy ─────────────────────────────────────────────────────────
// Higher index = higher privilege. Used by requireRole() range checks.
const ROLE_ORDER: MspRole[] = [
  "Free",
  "CustomerUser",
  "ServiceAccount",
  "MSPOperator",
  "MSPAdmin",
  "PlatformAdmin",
];

function roleIndex(role: MspRole | undefined): number {
  if (!role) return -1;
  return ROLE_ORDER.indexOf(role);
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// ── Core auth middleware ───────────────────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "JWT_SECRET not configured" });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as AuthUser;
    req.user = payload;

    // Enrich the per-request child logger with tenant context so every
    // downstream log line is automatically correlated to the MSP and customer.
    // pino-http already bound traceId (req.id) when it created req.log; we
    // just append mspId/customerId from the verified JWT claims here.
    if (req.log) {
      req.log = req.log.child({
        ...(payload.mspId != null ? { mspId: payload.mspId } : {}),
        ...(payload.customerId != null ? { customerId: payload.customerId } : {}),
      });
    }

    if (payload.impersonatedBy && !READ_METHODS.has(req.method)) {
      res.status(403).json({ error: "This action is not available in admin preview mode" });
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── Legacy admin guard (backward compat) ──────────────────────────────────────

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}

// ── MSP role guard ─────────────────────────────────────────────────────────────
/**
 * Require the user to have AT LEAST the specified MSP role.
 * Also accepts legacy `role: "admin"` users as PlatformAdmin.
 *
 * Example:
 *   router.get("/msps", requireRole("MSPAdmin"), handler);
 */
export function requireRole(minimumRole: MspRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req, res, () => {
      const user = req.user!;

      // Legacy admin users (role === "admin") treated as PlatformAdmin
      const effectiveRole: MspRole | undefined =
        user.role === "admin" ? "PlatformAdmin" : user.mspRole;

      if (roleIndex(effectiveRole) < roleIndex(minimumRole)) {
        res.status(403).json({
          error: `Insufficient privileges — ${minimumRole} or above required`,
        });
        return;
      }
      next();
    });
  };
}

// ── MSP scope guard ───────────────────────────────────────────────────────────
/**
 * Require that the user's mspId matches the mspId in the request params.
 * PlatformAdmins bypass this check (cross-MSP access).
 *
 * Usage: router.get("/msps/:mspId/customers", requireAuth, requireMspScope("params"), handler);
 * The mspId is read from req.params.mspId, req.query.mspId, or req.body.mspId
 * depending on the `source` argument.
 */
export function requireMspScope(source: "params" | "query" | "body" = "params") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // PlatformAdmin bypasses tenant isolation
    const effectiveRole: MspRole | undefined =
      user.role === "admin" ? "PlatformAdmin" : user.mspRole;
    if (effectiveRole === "PlatformAdmin") {
      next();
      return;
    }

    const rawMspId =
      source === "params"
        ? (req.params as Record<string, string>)["mspId"]
        : source === "query"
          ? String((req.query as Record<string, unknown>)["mspId"] ?? "")
          : String((req.body as Record<string, unknown>)["mspId"] ?? "");

    const requestedMspId = parseInt(rawMspId, 10);
    if (isNaN(requestedMspId)) {
      res.status(400).json({ error: "mspId is required" });
      return;
    }

    if (user.mspId !== requestedMspId) {
      res.status(403).json({ error: "Access to this MSP is not permitted" });
      return;
    }

    next();
  };
}

// ── Customer scope guard ──────────────────────────────────────────────────────
/**
 * Require the user to belong to the customer specified in params/query/body.
 * MSPAdmin and MSPOperator can access any customer within their MSP.
 * PlatformAdmin can access any customer.
 */
export function requireCustomerScope(source: "params" | "query" | "body" = "params") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const effectiveRole: MspRole | undefined =
      user.role === "admin" ? "PlatformAdmin" : user.mspRole;

    // PlatformAdmin bypasses all customer scope checks
    if (effectiveRole === "PlatformAdmin") {
      next();
      return;
    }

    // Extract the target customerId from the request
    const rawCustomerId =
      source === "params"
        ? (req.params as Record<string, string>)["customerId"]
        : source === "query"
          ? String((req.query as Record<string, unknown>)["customerId"] ?? "")
          : String((req.body as Record<string, unknown>)["customerId"] ?? "");

    const requestedCustomerId = parseInt(rawCustomerId, 10);
    if (isNaN(requestedCustomerId)) {
      res.status(400).json({ error: "customerId is required" });
      return;
    }

    // MSPAdmin/MSPOperator: verify target customer belongs to their MSP (IDOR prevention)
    if (effectiveRole === "MSPAdmin" || effectiveRole === "MSPOperator") {
      if (!user.mspId) {
        res.status(403).json({ error: "MSP operator token has no mspId claim" });
        return;
      }
      try {
        const [customer] = await db
          .select({ id: mspCustomersTable.id })
          .from(mspCustomersTable)
          .where(and(
            eq(mspCustomersTable.id, requestedCustomerId),
            eq(mspCustomersTable.mspId, user.mspId),
          ))
          .limit(1);
        if (!customer) {
          res.status(403).json({ error: "Access to this customer is not permitted" });
          return;
        }
        next();
      } catch {
        res.status(500).json({ error: "Customer scope verification failed" });
      }
      return;
    }

    // CustomerUser and Free: can only access their own customer (token-claim check)
    if (user.customerId !== requestedCustomerId) {
      res.status(403).json({ error: "Access to this customer is not permitted" });
      return;
    }

    next();
  };
}
