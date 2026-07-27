/**
 * Admin Navigation Pins — per-user pinned items in the admin panel left navigation.
 *
 *   GET /api/admin/nav-pins — get the caller's pinned item IDs (returns { pinned: string[] })
 *   PUT /api/admin/nav-pins — update the caller's pinned item IDs (expects { pinned: string[] })
 *
 * Self-scoped to req.user's own users row only.
 */

import { Router, type IRouter, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { z } from "zod";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "admin-nav-pins" });
const router: IRouter = Router();

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

const updatePinsSchema = z.object({
  pinned: z.array(z.string()),
});

router.get("/admin/nav-pins", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    apiError(res, 401, "Unauthorized");
    return;
  }

  try {
    const [row] = await db
      .select({ pinnedNavItems: usersTable.pinnedNavItems })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    res.json({ pinned: row?.pinnedNavItems ?? [] });
  } catch (err) {
    log.error({ err, userId }, "Failed to fetch admin nav pins");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/nav-pins", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    apiError(res, 401, "Unauthorized");
    return;
  }

  const parsed = updatePinsSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set({ pinnedNavItems: parsed.data.pinned })
      .where(eq(usersTable.id, userId))
      .returning({ pinnedNavItems: usersTable.pinnedNavItems });

    if (!updated) {
      apiError(res, 404, "User not found");
      return;
    }

    log.info({ userId, count: parsed.data.pinned.length }, "admin-nav-pins: updated");
    res.json({ pinned: updated.pinnedNavItems ?? [] });
  } catch (err) {
    log.error({ err, userId }, "Failed to update admin nav pins");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
