import { Router, type Request, type Response } from "express";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

router.get("/push/vapid-public-key", (_req: Request, res: Response) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    res.status(503).json({ error: "Push notifications are not configured on this server." });
    return;
  }
  res.json({ publicKey: key });
});

router.post("/push/subscribe", requireAdmin, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { endpoint, keys } = req.body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "endpoint, keys.p256dh and keys.auth are required" });
    return;
  }

  try {
    await db
      .insert(pushSubscriptionsTable)
      .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: { userId, p256dh: keys.p256dh, auth: keys.auth },
      });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/push/subscribe", requireAdmin, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { endpoint } = req.body as { endpoint?: string };

  if (!endpoint) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }

  try {
    await db
      .delete(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.endpoint, endpoint)));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
