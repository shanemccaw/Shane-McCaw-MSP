/**
 * Portal Theme Preference — account-level light/dark preference.
 *
 *   GET /api/portal/theme-preference — get the caller's own stored preference (or null)
 *   PUT /api/portal/theme-preference — update the caller's own preference
 *
 * Self-scoped to req.user's own msp_users row only — every authenticated
 * role gets this (not CustomerUser-specific), and there is no target-user
 * override; a caller can only ever read/write their own row.
 */

import { Router, type IRouter, type Response } from "express";
import { db, mspUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.msp-admin" });

const router: IRouter = Router();

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

const updateThemePreferenceSchema = z.object({
  theme: z.enum(["light", "dark"]),
});

router.get("/portal/theme-preference", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const [row] = await db
    .select({ themePreference: mspUsersTable.themePreference })
    .from(mspUsersTable)
    .where(eq(mspUsersTable.userId, userId))
    .limit(1);

  res.json({ theme: row?.themePreference ?? null });
});

router.put("/portal/theme-preference", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const parsed = updateThemePreferenceSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const [updated] = await db
    .update(mspUsersTable)
    .set({ themePreference: parsed.data.theme, updatedAt: new Date() })
    .where(eq(mspUsersTable.userId, userId))
    .returning({ themePreference: mspUsersTable.themePreference });

  if (!updated) {
    apiError(res, 404, "No MSP user profile found for this account");
    return;
  }

  log.info({ userId, theme: parsed.data.theme }, "portal-theme-preference: updated");
  res.json({ theme: updated.themePreference });
});

export default router;
