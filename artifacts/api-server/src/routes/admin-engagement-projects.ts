import { Router, type IRouter, type Request, type Response } from "express";
import { db, engagementProjectsTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { TENANT_SIGNALS } from "../lib/tenant-signals";

const router: IRouter = Router();

router.get("/admin/engagement-projects", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, title, price_range AS "priceRange", description, triggered_by AS "triggeredBy",
             sow_items AS "sowItems", pages, sort_order AS "sortOrder", is_visible AS "isVisible",
             meaning, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM engagement_projects
      ORDER BY sort_order ASC, created_at ASC
    `);
    res.json(rows.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch engagement projects" });
  }
});

router.get("/admin/engagement-projects/signals", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const projects = await db.execute(sql`
      SELECT id, title, triggered_by AS "triggeredBy"
      FROM engagement_projects WHERE is_visible = true
    `);

    const customRows = await db.execute(sql`
      SELECT key, label, description, expected_impact AS "expectedImpact"
      FROM custom_signals WHERE is_adjustment = FALSE ORDER BY created_at ASC
    `);
    const customSignals = (customRows.rows as Array<{ key: string; label: string; description: string; expectedImpact: string }>)
      .map(c => ({ key: c.key, label: c.label, description: c.description, expectedImpact: c.expectedImpact, recommendedRules: [] as never[] }));

    const allSignals = [...TENANT_SIGNALS, ...customSignals];

    const result = allSignals.map(signal => {
      const unlocksProjects = (projects.rows as Array<{ id: number; title: string; triggeredBy: string[] }>)
        .filter(p => Array.isArray(p.triggeredBy) && p.triggeredBy.includes(signal.key))
        .map(p => ({ id: p.id, title: p.title }));
      return { ...signal, unlocksProjects };
    });

    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to fetch signals" });
  }
});

router.get("/admin/engagement-projects/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const rows = await db.execute(sql`
      SELECT id, title, price_range AS "priceRange", description, triggered_by AS "triggeredBy",
             sow_items AS "sowItems", pages, sort_order AS "sortOrder", is_visible AS "isVisible",
             meaning, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM engagement_projects WHERE id = ${id} LIMIT 1
    `);
    if (rows.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch engagement project" });
  }
});

router.post("/admin/engagement-projects", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { title, priceRange, description, meaning, triggeredBy, sowItems, pages, sortOrder, isVisible } = body;
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" }); return;
    }
    if (!priceRange || typeof priceRange !== "string" || !priceRange.trim()) {
      res.status(400).json({ error: "priceRange is required" }); return;
    }
    const rows = await db.execute(sql`
      INSERT INTO engagement_projects (title, price_range, description, meaning, triggered_by, sow_items, pages, sort_order, is_visible)
      VALUES (
        ${(title as string).trim()},
        ${(priceRange as string).trim()},
        ${typeof description === "string" ? description.trim() || null : null},
        ${typeof meaning === "string" ? meaning.trim() || null : null},
        ${JSON.stringify(Array.isArray(triggeredBy) ? triggeredBy : [])}::jsonb,
        ${JSON.stringify(Array.isArray(sowItems) ? sowItems : [])}::jsonb,
        ${JSON.stringify(Array.isArray(pages) ? pages : [])}::jsonb,
        ${typeof sortOrder === "number" ? sortOrder : 0},
        ${typeof isVisible === "boolean" ? isVisible : true}
      )
      RETURNING id, title, price_range AS "priceRange", description, triggered_by AS "triggeredBy",
                sow_items AS "sowItems", pages, sort_order AS "sortOrder", is_visible AS "isVisible",
                meaning, created_at AS "createdAt", updated_at AS "updatedAt"
    `);
    res.status(201).json(rows.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create engagement project" });
  }
});

router.put("/admin/engagement-projects/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { title, priceRange, description, meaning, triggeredBy, sowItems, pages, sortOrder, isVisible } = body;
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" }); return;
    }
    if (!priceRange || typeof priceRange !== "string" || !priceRange.trim()) {
      res.status(400).json({ error: "priceRange is required" }); return;
    }
    const rows = await db.execute(sql`
      UPDATE engagement_projects SET
        title = ${(title as string).trim()},
        price_range = ${(priceRange as string).trim()},
        description = ${typeof description === "string" ? description.trim() || null : null},
        meaning = ${typeof meaning === "string" ? meaning.trim() || null : null},
        triggered_by = ${JSON.stringify(Array.isArray(triggeredBy) ? triggeredBy : [])}::jsonb,
        sow_items = ${JSON.stringify(Array.isArray(sowItems) ? sowItems : [])}::jsonb,
        pages = ${JSON.stringify(Array.isArray(pages) ? pages : [])}::jsonb,
        sort_order = ${typeof sortOrder === "number" ? sortOrder : 0},
        is_visible = ${typeof isVisible === "boolean" ? isVisible : true},
        updated_at = now()
      WHERE id = ${id}
      RETURNING id, title, price_range AS "priceRange", description, triggered_by AS "triggeredBy",
                sow_items AS "sowItems", pages, sort_order AS "sortOrder", is_visible AS "isVisible",
                meaning, created_at AS "createdAt", updated_at AS "updatedAt"
    `);
    if (rows.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to update engagement project" });
  }
});

router.delete("/admin/engagement-projects/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.execute(sql`DELETE FROM engagement_projects WHERE id = ${id}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete engagement project" });
  }
});

export default router;
