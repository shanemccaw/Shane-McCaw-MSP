import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

export interface AuditEvent {
  actorUserId?: number | null;
  actorName: string;
  actorRole: "admin" | "client";
  actionType: string;
  entityType: string;
  entityId?: string | number | null;
  entityLabel?: string | null;
  clientId?: number | null;
  projectId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export async function createAuditLog(event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorUserId: event.actorUserId ?? null,
      actorName: event.actorName,
      actorRole: event.actorRole,
      actionType: event.actionType,
      entityType: event.entityType,
      entityId: event.entityId != null ? String(event.entityId) : null,
      entityLabel: event.entityLabel ?? null,
      clientId: event.clientId ?? null,
      projectId: event.projectId ?? null,
      metadata: event.metadata ?? null,
    });
  } catch (err) {
    logger.error({ err, event }, "createAuditLog: failed to write audit entry");
  }
}
