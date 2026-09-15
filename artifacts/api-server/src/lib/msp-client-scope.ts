/**
 * msp-client-scope.ts
 *
 * MSP ownership scoping for admin-* client routes opened to
 * `ladder.msp-operator` (Git #4255) — the same model #4251 established in
 * admin-projects.ts, lifted out so admin-clients.ts and admin-m365-run.ts share
 * one definition instead of each growing its own.
 *
 * Ownership chain: a client is a `users` row, and an MSP owns it iff
 * `users.msp_id` is that MSP. Everything a script run touches (App Registration,
 * legacy tenant credential, kanban task, run result) resolves to a client user
 * and is checked through that single join.
 *
 * `mspId: null` is the PlatformAdmin cross-platform view (no ?mspId= override).
 * A PlatformAdmin passing ?mspId= is scoped to that MSP. MSP staff are always
 * scoped to their own JWT mspId; a staff session with no mspId gets 403.
 */

import type { Request, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import { effectiveMspRole } from "../middlewares/requireAuth.ts";
import { resolveMspId } from "./resolve-msp-id.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "tenant.scope" });

export type ClientScope = { mspId: number | null };

/** Resolve the caller's scope, or null when an MSP-staff session carries no mspId. */
export async function resolveClientScope(req: Request): Promise<ClientScope | null> {
  const mspId = await resolveMspId(req);
  if (mspId !== null) return { mspId };
  return effectiveMspRole(req.user!) === LEGACY_ROLE.platformAdmin ? { mspId: null } : null;
}

/** Resolve scope for a handler, answering 403 itself when the session has no MSP context. */
export async function requireClientScope(req: Request, res: Response): Promise<ClientScope | null> {
  const scope = await resolveClientScope(req);
  if (!scope) {
    log.warn({ userId: req.user?.id, path: req.path }, "MSP-staff session has no mspId — denied");
    res.status(403).json({ error: "No MSP context on this session" });
  }
  return scope;
}

/** True when `clientUserId` is a client the scope may act on. */
export async function clientInScope(scope: ClientScope, clientUserId: number | null | undefined): Promise<boolean> {
  if (clientUserId == null) return scope.mspId === null;
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(scope.mspId === null
      ? eq(usersTable.id, clientUserId)
      : and(eq(usersTable.id, clientUserId), eq(usersTable.mspId, scope.mspId)))
    .limit(1);
  return Boolean(row);
}
