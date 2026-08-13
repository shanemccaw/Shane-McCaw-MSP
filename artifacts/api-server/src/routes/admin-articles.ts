import { Router, type IRouter, type Request, type Response } from "express";
import { db, articlesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import fs from "node:fs/promises";
import path from "node:path";

const router: IRouter = Router();

const SLUG_RE = /^[a-z0-9-]+$/;

function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// ARTICLES_DIR: where .md files live for the public Vite site
const ARTICLES_DIR = path.resolve(
  process.cwd(),
  "../../artifacts/shane-mccaw-consulting/src/content/articles",
);

function buildMd(article: { slug: string; category: string; title: string; summary: string; date: string; content: string }): string {
  return (
    `---\nslug: ${article.slug}\ncategory: ${article.category}\n` +
    `title: "${article.title.replace(/"/g, '\\"')}"\n` +
    `summary: "${article.summary.replace(/"/g, '\\"')}"\n` +
    `date: ${article.date}\n---\n\n${article.content}`
  );
}

function toDto(r: typeof articlesTable.$inferSelect) {
  return {
    slug: r.slug,
    category: r.category,
    title: r.title,
    summary: r.summary,
    date: r.date,
    content: r.content,
    isPublished: r.isPublished,
    filename: `${r.slug}.md`,
  };
}

router.get("/admin/articles", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(articlesTable)
      .orderBy(desc(articlesTable.updatedAt));
    res.json(rows.map(toDto));
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
    res.json(toDto(row));
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
      isPublished: true,
    });

    // Manually created articles are published immediately — write .md file
    const article = { slug, category: category ?? "", title, summary: summary ?? "", date, content: content ?? "" };
    await fs.mkdir(ARTICLES_DIR, { recursive: true });
    await fs.writeFile(path.join(ARTICLES_DIR, `${slug}.md`), buildMd(article), "utf8");

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

    const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, oldSlug));
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

    // If previously published, keep .md in sync; if draft, don't write yet
    if (existing.isPublished) {
      const article = { slug, category: category ?? "", title, summary: summary ?? "", date, content: content ?? "" };
      await fs.mkdir(ARTICLES_DIR, { recursive: true });
      await fs.writeFile(path.join(ARTICLES_DIR, `${slug}.md`), buildMd(article), "utf8");
      // If slug changed, remove old .md
      if (slug !== oldSlug) {
        await fs.rm(path.join(ARTICLES_DIR, `${oldSlug}.md`), { force: true });
      }
    }

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
    const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug));
    if (!existing) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    await db.delete(articlesTable).where(eq(articlesTable.slug, slug));
    // Remove .md file if it exists
    await fs.rm(path.join(ARTICLES_DIR, `${slug}.md`), { force: true });
    res.json({ deleted: slug });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete article" });
  }
});

// Approve a draft — sets is_published = true and writes the .md file
router.post("/admin/articles/:slug/publish", requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug));
    if (!existing) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    if (existing.isPublished) {
      res.json({ slug, alreadyPublished: true });
      return;
    }

    await db.update(articlesTable)
      .set({ isPublished: true, updatedAt: new Date() })
      .where(eq(articlesTable.slug, slug));

    // Write the .md file so the public site picks it up
    await fs.mkdir(ARTICLES_DIR, { recursive: true });
    await fs.writeFile(path.join(ARTICLES_DIR, `${slug}.md`), buildMd(existing), "utf8");

    res.json({ slug, published: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to publish article" });
  }
});

// Discard a draft — deletes it entirely (published articles use DELETE)
router.post("/admin/articles/:slug/discard", requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const [existing] = await db.select({ slug: articlesTable.slug, isPublished: articlesTable.isPublished }).from(articlesTable).where(eq(articlesTable.slug, slug));
    if (!existing) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    if (existing.isPublished) {
      res.status(400).json({ error: "Cannot discard a published article — use DELETE instead" });
      return;
    }
    await db.delete(articlesTable).where(eq(articlesTable.slug, slug));
    res.json({ discarded: slug });
  } catch (err) {
    res.status(500).json({ error: "Failed to discard draft" });
  }
});

export default router;
