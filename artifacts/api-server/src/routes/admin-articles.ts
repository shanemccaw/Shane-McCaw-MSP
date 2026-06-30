import { Router, type IRouter, type Request, type Response } from "express";
import { db, articlesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

const SLUG_RE = /^[a-z0-9-]+$/;

function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

router.get("/admin/articles", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(articlesTable)
      .orderBy(desc(articlesTable.updatedAt));
    res.json(rows.map(r => ({
      slug: r.slug,
      category: r.category,
      title: r.title,
      summary: r.summary,
      date: r.date,
      content: r.content,
      filename: `${r.slug}.md`,
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to read articles" });
  }
});

router.get("/admin/articles/:slug", requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const [row] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug));
    if (!row) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.json({
      slug: row.slug,
      category: row.category,
      title: row.title,
      summary: row.summary,
      date: row.date,
      content: row.content,
      filename: `${row.slug}.md`,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read article" });
  }
});

router.post("/admin/articles", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { slug, category, title, summary, date, content } = req.body as Record<string, string>;
    if (!slug || !title || !date) {
      res.status(400).json({ error: "slug, title, and date are required" });
      return;
    }
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug: use only lowercase letters, numbers, and hyphens" });
      return;
    }
    const [existing] = await db.select({ slug: articlesTable.slug }).from(articlesTable).where(eq(articlesTable.slug, slug));
    if (existing) {
      res.status(409).json({ error: "An article with this slug already exists" });
      return;
    }
    await db.insert(articlesTable).values({
      slug,
      category: category ?? "",
      title,
      summary: summary ?? "",
      date,
      content: content ?? "",
    });
    res.status(201).json({ slug, filename: `${slug}.md` });
  } catch (err) {
    res.status(500).json({ error: "Failed to create article" });
  }
});

router.put("/admin/articles/:slug", requireAdmin, async (req: Request, res: Response) => {
  try {
    const oldSlug = req.params.slug as string;
    const { slug, category, title, summary, date, content } = req.body as Record<string, string>;

    if (!isValidSlug(oldSlug)) {
      res.status(400).json({ error: "Invalid slug in URL" });
      return;
    }
    if (!slug || !title || !date) {
      res.status(400).json({ error: "slug, title, and date are required" });
      return;
    }
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug: use only lowercase letters, numbers, and hyphens" });
      return;
    }

    const [existing] = await db.select({ slug: articlesTable.slug }).from(articlesTable).where(eq(articlesTable.slug, oldSlug));
    if (!existing) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    if (slug !== oldSlug) {
      const [conflict] = await db.select({ slug: articlesTable.slug }).from(articlesTable).where(eq(articlesTable.slug, slug));
      if (conflict) {
        res.status(409).json({ error: "An article with the new slug already exists" });
        return;
      }
    }

    await db.update(articlesTable).set({
      slug,
      category: category ?? "",
      title,
      summary: summary ?? "",
      date,
      content: content ?? "",
      updatedAt: new Date(),
    }).where(eq(articlesTable.slug, oldSlug));

    res.json({ slug, filename: `${slug}.md` });
  } catch (err) {
    res.status(500).json({ error: "Failed to update article" });
  }
});

router.delete("/admin/articles/:slug", requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const [existing] = await db.select({ slug: articlesTable.slug }).from(articlesTable).where(eq(articlesTable.slug, slug));
    if (!existing) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    await db.delete(articlesTable).where(eq(articlesTable.slug, slug));
    res.json({ deleted: slug });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete article" });
  }
});

export default router;
