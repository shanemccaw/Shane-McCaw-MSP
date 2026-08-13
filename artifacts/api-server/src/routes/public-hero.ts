import { Router, type IRouter, type Request, type Response } from "express";
import { db, heroHeadlinesTable } from "@workspace/db";
import { and, asc, eq, isNull, lte, gte, or, sql } from "drizzle-orm";

const router: IRouter = Router();

// ── GET /api/public/hero-headlines ─────────────────────────────────────────────
// Public endpoint — no auth required. Returns active headlines that are either
// evergreen (start_date/end_date both null) or currently within their seasonal
// window, ordered by sort_order ASC.

router.get("/public/hero-headlines", async (_req: Request, res: Response) => {
  try {
    const today = sql`current_date`;
    const rows = await db
      .select()
      .from(heroHeadlinesTable)
      .where(
        and(
          eq(heroHeadlinesTable.active, true),
          or(
            and(isNull(heroHeadlinesTable.startDate), isNull(heroHeadlinesTable.endDate)),
            and(lte(heroHeadlinesTable.startDate, today), gte(heroHeadlinesTable.endDate, today)),
          ),
        ),
      )
      .orderBy(asc(heroHeadlinesTable.sortOrder));
    res.json(rows.map((r) => ({ leadText: r.leadText, gradientText: r.gradientText, seasonalLabel: r.seasonalLabel })));
  } catch {
    res.status(500).json({ error: "Failed to fetch hero headlines" });
  }
});

export default router;
