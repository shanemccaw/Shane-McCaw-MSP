/**
 * MSP Audit Log Route — filterable audit trail from msp_audit_logs.
 *
 * GET /api/msp/audit
 *   Query params:
 *     page, limit, search, actionType, mspId (PlatformAdmin), outcome, from, to
 *
 * PlatformAdmin sees all entries. MSP users see only their own MSP's entries.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspAuditLogsTable, usersTable } from "@workspace/db";
import { eq, and, desc, count, ilike, or, gte, lte, inArray, type SQL } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";

const router: IRouter = Router();

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

router.get("/msp/audit", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const user = req.user!;
  const page = Math.max(1, parseInt(p(req.query["page"] as string | undefined) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(p(req.query["limit"] as string | undefined) || "30", 10)));
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];

  // Scope by MSP unless PlatformAdmin
  if (user.role !== "admin" && user.mspRole !== "PlatformAdmin") {
    if (!user.mspId) {
      res.json({ entries: [], total: 0, page, limit });
      return;
    }
    conditions.push(eq(mspAuditLogsTable.mspId, user.mspId));
  } else if (req.query["mspId"]) {
    const mspId = parseInt(p(req.query["mspId"] as string | undefined), 10);
    if (!isNaN(mspId)) {
      conditions.push(eq(mspAuditLogsTable.mspId, mspId));
    }
  }

  if (req.query["actionType"]) {
    const at = p(req.query["actionType"] as string | undefined);
    conditions.push(ilike(mspAuditLogsTable.actionType, `%${at}%`));
  }

  if (req.query["outcome"] && ["success", "failure", "partial"].includes(p(req.query["outcome"] as string | undefined))) {
    conditions.push(eq(mspAuditLogsTable.outcome, p(req.query["outcome"] as string | undefined) as "success" | "failure" | "partial"));
  }

  if (req.query["from"]) {
    const d = new Date(p(req.query["from"] as string | undefined));
    if (!isNaN(d.getTime())) conditions.push(gte(mspAuditLogsTable.occurredAt, d));
  }

  if (req.query["to"]) {
    const d = new Date(p(req.query["to"] as string | undefined));
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(mspAuditLogsTable.occurredAt, d));
    }
  }

  const search = p(req.query["search"] as string | undefined);
  if (search) {
    conditions.push(
      or(
        ilike(mspAuditLogsTable.actionType, `%${search}%`),
        ilike(mspAuditLogsTable.entityType, `%${search}%`),
        ilike(mspAuditLogsTable.entityLabel, `%${search}%`),
        ilike(mspAuditLogsTable.actorRole, `%${search}%`),
      ) as SQL,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ total: count() }).from(mspAuditLogsTable).where(where);
  const entries = await db
    .select({
      id: mspAuditLogsTable.id,
      eventId: mspAuditLogsTable.eventId,
      actorUserId: mspAuditLogsTable.actorUserId,
      actorRole: mspAuditLogsTable.actorRole,
      mspId: mspAuditLogsTable.mspId,
      customerId: mspAuditLogsTable.customerId,
      actionType: mspAuditLogsTable.actionType,
      entityType: mspAuditLogsTable.entityType,
      entityId: mspAuditLogsTable.entityId,
      entityLabel: mspAuditLogsTable.entityLabel,
      outcome: mspAuditLogsTable.outcome,
      ipAddress: mspAuditLogsTable.ipAddress,
      occurredAt: mspAuditLogsTable.occurredAt,
      metadata: mspAuditLogsTable.metadata,
    })
    .from(mspAuditLogsTable)
    .where(where)
    .orderBy(desc(mspAuditLogsTable.occurredAt))
    .limit(limit)
    .offset(offset);

  // Attach actor email where available (fetch ALL unique actor IDs, not just the first)
  const actorIds = [...new Set(entries.map((e) => e.actorUserId).filter((id): id is number => id != null))];
  const actors = actorIds.length > 0
    ? await db
        .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, actorIds))
    : [];

  const actorMap = new Map(actors.map((a) => [a.id, a]));

  // Serialize with UI-friendly field aliases so the client doesn't need to know
  // the internal column names (actionType → action, entityLabel → resource,
  // metadata → detail as a short string, occurredAt → createdAt as ISO string).
  const enriched = entries.map((e) => {
    const actor = e.actorUserId ? actorMap.get(e.actorUserId) : null;
    const detail = e.metadata
      ? typeof e.metadata === "string"
        ? e.metadata
        : JSON.stringify(e.metadata)
      : null;
    return {
      id: e.id,
      eventId: e.eventId,
      actorEmail: actor?.email ?? e.actorRole ?? null,
      actorName: actor?.name ?? null,
      actorRole: e.actorRole,
      action: e.actionType,
      resource: e.entityLabel ?? e.entityType ?? null,
      detail,
      outcome: e.outcome,
      createdAt: e.occurredAt instanceof Date ? e.occurredAt.toISOString() : String(e.occurredAt),
    };
  });

  res.json({ entries: enriched, total: totalRow?.total ?? 0, page, limit });
});

export default router;
