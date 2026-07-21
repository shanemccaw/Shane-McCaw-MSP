import { Router, type IRouter, type Request, type Response } from "express";
import { db, engagementProjectsTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { getProjectSignalDefinitions } from "../lib/tenant-signals";

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

    // Every project (non-adjustment) signal — built-in and custom — from the
    // unified custom_signals catalog.
    const allSignals = await getProjectSignalDefinitions();

    const enabledRows = await db.execute(sql`
      SELECT signal_key AS "signalKey", enabled FROM signal_enabled_state
    `);
    const enabledMap = new Map(
      (enabledRows.rows as Array<{ signalKey: string; enabled: boolean }>).map(r => [r.signalKey, r.enabled]),
    );

    const result = allSignals.map(signal => {
      const unlocksProjects = (projects.rows as Array<{ id: number; title: string; triggeredBy: string[] }>)
        .filter(p => Array.isArray(p.triggeredBy) && p.triggeredBy.includes(signal.key))
        .map(p => ({ id: p.id, title: p.title }));
      return { ...signal, unlocksProjects, enabled: enabledMap.get(signal.key) ?? true };
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

// ─── POST /api/admin/engagement-projects/publish-to-prod ─────────────────────
// Upserts all engagement projects (by title) from dev into the production DB,
// then removes any prod rows whose titles are absent from dev.

router.post("/admin/engagement-projects/publish-to-prod", requireAdmin, async (req: Request, res: Response) => {
  const dryRun = String(req.query["dryRun"] ?? "") === "true";
  const { isProdDbConfigured, buildProdDb } = await import("../lib/prod-db.ts");
  if (!isProdDbConfigured()) {
    res.status(503).json({ error: "Production database is not configured. Set DATABASE_URL_PROD in Replit Secrets." });
    return;
  }

  try {
    const devRows = await db.execute(sql`
      SELECT title, price_range, description, meaning, triggered_by, sow_items, pages, sort_order, is_visible
      FROM engagement_projects ORDER BY sort_order ASC, created_at ASC
    `);
    const devProjects = devRows.rows as Array<{
      title: string; price_range: string; description: string | null; meaning: string | null;
      triggered_by: string[]; sow_items: string[]; pages: string[]; sort_order: number; is_visible: boolean;
    }>;
    const devTitleSet = new Set(devProjects.map(p => p.title));

    const { pool: prodPool } = buildProdDb();
    const client = await prodPool.connect();

    try {
      if (dryRun) {
        // Fetch all publish-relevant fields from prod for accurate field-level diff
        const prodResult = await client.query<{
          title: string;
          price_range: string;
          description: string | null;
          meaning: string | null;
          triggered_by: string[];
          sow_items: string[];
          pages: string[];
          sort_order: number;
          is_visible: boolean;
        }>(`SELECT title, price_range, description, meaning, triggered_by, sow_items, pages, sort_order, is_visible FROM engagement_projects`);

        const prodMap = new Map(prodResult.rows.map(r => [r.title, r]));

        const added = devProjects
          .filter(p => !prodMap.has(p.title))
          .map(p => ({ title: p.title, priceRange: p.price_range }));

        const updated: Array<{ title: string }> = [];
        for (const p of devProjects) {
          const q = prodMap.get(p.title);
          if (!q) continue; // new — already in added
          const arrEq = (a: string[], b: string[]) =>
            a.length === b.length && a.every((v, i) => v === b[i]);
          const changed =
            p.price_range !== q.price_range ||
            (p.description ?? null) !== (q.description ?? null) ||
            (p.meaning ?? null) !== (q.meaning ?? null) ||
            p.sort_order !== q.sort_order ||
            p.is_visible !== q.is_visible ||
            !arrEq(p.triggered_by ?? [], q.triggered_by ?? []) ||
            !arrEq(p.sow_items ?? [], q.sow_items ?? []) ||
            !arrEq(p.pages ?? [], q.pages ?? []);
          if (changed) updated.push({ title: p.title });
        }

        const removed = prodResult.rows
          .filter(r => !devTitleSet.has(r.title))
          .map(r => ({ title: r.title }));

        res.json({ dryRun: true, added, updated, removed });
        return;
      }

      // Actual write
      let upserted = 0;
      let removed = 0;

      await client.query("BEGIN");

      for (const p of devProjects) {
        const existing = await client.query(
          `SELECT id FROM engagement_projects WHERE title = $1 LIMIT 1`, [p.title]
        );
        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE engagement_projects SET
               price_range = $2, description = $3, meaning = $4,
               triggered_by = $5::jsonb, sow_items = $6::jsonb, pages = $7::jsonb,
               sort_order = $8, is_visible = $9, updated_at = now()
             WHERE title = $1`,
            [p.title, p.price_range, p.description, p.meaning,
             JSON.stringify(p.triggered_by), JSON.stringify(p.sow_items), JSON.stringify(p.pages),
             p.sort_order, p.is_visible]
          );
        } else {
          await client.query(
            `INSERT INTO engagement_projects (title, price_range, description, meaning, triggered_by, sow_items, pages, sort_order, is_visible)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)`,
            [p.title, p.price_range, p.description, p.meaning,
             JSON.stringify(p.triggered_by), JSON.stringify(p.sow_items), JSON.stringify(p.pages),
             p.sort_order, p.is_visible]
          );
        }
        upserted++;
      }

      // Remove prod rows not present in dev
      if (devProjects.length > 0) {
        const titles = devProjects.map(p => p.title);
        const placeholders = titles.map((_, i) => `$${i + 1}`).join(", ");
        const del = await client.query(
          `DELETE FROM engagement_projects WHERE title NOT IN (${placeholders})`, titles
        );
        removed = del.rowCount ?? 0;
      }

      await client.query("COMMIT");
      res.json({ ok: true, upserted, removed });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => { /* ignore */ });
      throw err;
    } finally {
      client.release();
      await prodPool.end();
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to publish to production" });
  }
});

export default router;
