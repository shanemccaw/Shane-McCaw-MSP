import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, shareEventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

const VALID_PLATFORMS = ["linkedin", "x"] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(500).json({ error: "ADMIN_PASSWORD not configured" });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${adminPassword}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.post("/shares", async (req: Request, res: Response) => {
  const { slug, platform } = req.body as { slug?: string; platform?: string };

  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(400).json({ error: "Invalid or missing slug" });
    return;
  }
  if (!platform || !VALID_PLATFORMS.includes(platform as Platform)) {
    res.status(400).json({ error: "platform must be 'linkedin' or 'x'" });
    return;
  }

  try {
    await db.insert(shareEventsTable).values({ slug, platform: platform as Platform });
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to record share" });
  }
});

router.get("/shares", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        slug: shareEventsTable.slug,
        platform: shareEventsTable.platform,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(shareEventsTable)
      .groupBy(shareEventsTable.slug, shareEventsTable.platform);

    const counts: Record<string, { linkedin: number; x: number; total: number }> = {};
    let total = 0;

    for (const row of rows) {
      if (!counts[row.slug]) counts[row.slug] = { linkedin: 0, x: 0, total: 0 };
      counts[row.slug][row.platform as Platform] = row.count;
      counts[row.slug].total += row.count;
      total += row.count;
    }

    res.json({ counts, total });
  } catch {
    res.status(500).json({ error: "Failed to read shares" });
  }
});

export default router;
