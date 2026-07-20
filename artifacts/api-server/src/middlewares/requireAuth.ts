import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, mspCustomersTable, mspStaffCustomerScopesTable, type MspRole } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { enrichRequestContext } from "../lib/request-context.ts";

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
// "Assessment" and "Free" share the bottom tier (both below CustomerUser): every
// requireRole() floor in the codebase is CustomerUser or higher, so both are
// rejected identically. Assessment is placed at the absolute bottom so it can
// never resolve to a higher privilege than Free under index comparison.
const ROLE_ORDER: MspRole[] = [
  "Assessment",
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

    // Single source of truth for when mspId/actor become known during a
    // request — downstream consumers (event-bus, audit inserts) read these
    // from the AsyncLocalStorage context regardless of which router ran.
    enrichRequestContext({
      mspId: payload.mspId ?? null,
      customerId: (payload as AuthUser & { customerId?: number | null }).customerId ?? null,
      actor: { id: payload.id, role: payload.mspRole ?? payload.role },
    });

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
/**
 * Tiered ownership check: is `user` permitted to act on `customerId`?
 *
 * - PlatformAdmin (`role === "admin"`)      → always.
 * - MSPAdmin / MSPOperator                  → iff the customer belongs to their MSP (DB IDOR check).
 * - CustomerUser / Free / Assessment        → iff it is their own customer (token claim).
 * - anything else                           → denied.
 *
 * The single source of truth for this rule. `requireCustomerScope` (which reads the
 * customerId from the request and answers 403) is a thin wrapper over it; callers
 * whose customerId is DB-resolved — e.g. break-glass, where denial must read as 404,
 * not 403 — call this directly.
 */
export async function assertCustomerAccess(user: AuthUser, customerId: number): Promise<boolean> {
  const effectiveRole: MspRole | undefined =
    user.role === "admin" ? "PlatformAdmin" : user.mspRole;

  if (effectiveRole === "PlatformAdmin") return true;

  if (effectiveRole === "MSPAdmin" || effectiveRole === "MSPOperator") {
    if (!user.mspId) return false;
    const [customer] = await db
      .select({ id: mspCustomersTable.id })
      .from(mspCustomersTable)
      .where(and(
        eq(mspCustomersTable.id, customerId),
        eq(mspCustomersTable.mspId, user.mspId),
      ))
      .limit(1);
    if (!customer) return false;
    // Per-staff-member tenant-access scoping (additive, opt-in). A staff member
    // with no scope rows is unrestricted (historical default); once scoped, they
    // may only reach customers in their assigned set — even within their own MSP.
    if (await isCustomerBlockedByStaffScope(user, customerId)) return false;
    return true;
  }

  if (effectiveRole === "CustomerUser" || effectiveRole === "Free" || effectiveRole === "Assessment") {
    return user.customerId === customerId;
  }

  return false;
}

// ── Per-staff-member customer-access scoping (msp_staff_customer_scopes) ────────
/**
 * Returns the explicit set of `msp_customers.id` an MSP staff member is limited
 * to, or `null` when the member is UNRESTRICTED. `null` means "no restriction"
 * — the historical default — and is returned both when the member has zero
 * scope rows and when their role is not MSP-staff.
 *
 * Only MSPAdmin / MSPOperator can be scoped. PlatformAdmin is cross-MSP and is
 * never scoped here; CustomerUser / Free / Assessment are already pinned to
 * their own `customerId` claim, so per-customer scoping does not apply to them.
 *
 * List/aggregate routes call this to narrow their result set (e.g.
 * `inArray(table.customerId, ids)` when non-null). Single-customer routes should
 * prefer `assertCustomerAccess` (which already folds this in) or
 * `isCustomerBlockedByStaffScope`.
 */
export async function resolveStaffScopedCustomerIds(user: AuthUser): Promise<number[] | null> {
  const effectiveRole: MspRole | undefined =
    user.role === "admin" ? "PlatformAdmin" : user.mspRole;
  if (effectiveRole !== "MSPAdmin" && effectiveRole !== "MSPOperator") return null;

  const rows = await db
    .select({ customerId: mspStaffCustomerScopesTable.customerId })
    .from(mspStaffCustomerScopesTable)
    .where(eq(mspStaffCustomerScopesTable.staffUserId, user.id));

  if (rows.length === 0) return null; // unrestricted — full MSP access
  return rows.map((r) => r.customerId);
}

/**
 * True when `user` is a scoped MSP staff member whose assigned customer set does
 * NOT include `customerId`. False (i.e. allowed) whenever the member is
 * unrestricted, including for every non-MSP-staff role. Use this to fence a
 * single-customer route that resolves its own customerId.
 */
export async function isCustomerBlockedByStaffScope(user: AuthUser, customerId: number): Promise<boolean> {
  const scoped = await resolveStaffScopedCustomerIds(user);
  return scoped !== null && !scoped.includes(customerId);
}

export function requireCustomerScope(source: "params" | "query" | "body" = "params") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // PlatformAdmin bypasses all customer scope checks (no customerId required)
    if (user.role === "admin" || user.mspRole === "PlatformAdmin") {
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

    try {
      const ok = await assertCustomerAccess(user, requestedCustomerId);
      if (!ok) {
        res.status(403).json({ error: "Access to this customer is not permitted" });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: "Customer scope verification failed" });
    }
  };
}
