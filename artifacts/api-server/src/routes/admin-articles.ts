import { Router, type IRouter, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

const ARTICLES_DIR = process.env.ARTICLES_DIR
  ? path.resolve(process.env.ARTICLES_DIR)
  : path.resolve("../shane-mccaw-consulting/src/content/articles");

const SLUG_RE = /^[a-z0-9-]+$/;

function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function safeFilePath(slug: string): string | null {
  if (!isValidSlug(slug)) return null;
  const resolved = path.resolve(path.join(ARTICLES_DIR, `${slug}.md`));
  if (!resolved.startsWith(ARTICLES_DIR + path.sep) && resolved !== ARTICLES_DIR) return null;
  return resolved;
}

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };

  const yamlBlock = match[1];
  const content = match[2];
  const data: Record<string, string> = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }

  return { data, content };
}

function buildMarkdown(article: {
  slug: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  content: string;
}): string {
  return `---\nslug: ${article.slug}\ncategory: ${article.category}\ntitle: "${article.title.replace(/"/g, '\\"')}"\nsummary: "${article.summary.replace(/"/g, '\\"')}"\ndate: ${article.date}\n---\n\n${article.content}`;
}

router.get("/admin/articles", requireAdmin, (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
    const articles = files.map((file) => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf-8");
      const { data, content } = parseFrontmatter(raw);
      return {
        slug: data.slug ?? "",
        category: data.category ?? "",
        title: data.title ?? "",
        summary: data.summary ?? "",
        date: data.date ?? "",
        content,
        filename: file,
      };
    }).filter((a) => a.slug && a.title && a.date)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json(articles);
  } catch {
    res.status(500).json({ error: "Failed to read articles" });
  }
});

router.get("/admin/articles/:slug", requireAdmin, (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
    const file = files.find((f) => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, f), "utf-8");
      const { data } = parseFrontmatter(raw);
      return data.slug === slug;
    });

    if (!file) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf-8");
    const { data, content } = parseFrontmatter(raw);
    res.json({ slug: data.slug, category: data.category, title: data.title, summary: data.summary, date: data.date, content, filename: file });
  } catch {
    res.status(500).json({ error: "Failed to read article" });
  }
});

router.post("/admin/articles", requireAdmin, (req: Request, res: Response) => {
  try {
    const { slug, category, title, summary, date, content } = req.body as Record<string, string>;
    if (!slug || !title || !date) {
      res.status(400).json({ error: "slug, title, and date are required" });
      return;
    }
    const filepath = safeFilePath(slug);
    if (!filepath) {
      res.status(400).json({ error: "Invalid slug: use only lowercase letters, numbers, and hyphens" });
      return;
    }
    if (fs.existsSync(filepath)) {
      res.status(409).json({ error: "An article with this slug already exists" });
      return;
    }
    const markdown = buildMarkdown({ slug, category: category ?? "", title, summary: summary ?? "", date, content: content ?? "" });
    fs.writeFileSync(filepath, markdown, "utf-8");
    res.status(201).json({ slug, filename: `${slug}.md` });
  } catch {
    res.status(500).json({ error: "Failed to create article" });
  }
});

router.put("/admin/articles/:slug", requireAdmin, (req: Request, res: Response) => {
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
    const newFilepath = safeFilePath(slug);
    if (!newFilepath) {
      res.status(400).json({ error: "Invalid slug: use only lowercase letters, numbers, and hyphens" });
      return;
    }

    const files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");

    const oldFile = files.find((f) => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, f), "utf-8");
      const { data } = parseFrontmatter(raw);
      return data.slug === oldSlug;
    });

    if (!oldFile) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const newFilename = `${slug}.md`;
    const slugChanged = oldFile !== newFilename;

    if (slugChanged && fs.existsSync(newFilepath)) {
      res.status(409).json({ error: "An article with the new slug already exists" });
      return;
    }

    const markdown = buildMarkdown({ slug, category: category ?? "", title, summary: summary ?? "", date, content: content ?? "" });

    if (slugChanged) {
      fs.unlinkSync(path.join(ARTICLES_DIR, oldFile));
    }
    fs.writeFileSync(newFilepath, markdown, "utf-8");
    res.json({ slug, filename: newFilename });
  } catch {
    res.status(500).json({ error: "Failed to update article" });
  }
});

router.delete("/admin/articles/:slug", requireAdmin, (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
    const file = files.find((f) => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, f), "utf-8");
      const { data } = parseFrontmatter(raw);
      return data.slug === slug;
    });

    if (!file) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const filepath = path.resolve(path.join(ARTICLES_DIR, file));
    if (!filepath.startsWith(ARTICLES_DIR + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    fs.unlinkSync(filepath);
    res.json({ deleted: slug });
  } catch {
    res.status(500).json({ error: "Failed to delete article" });
  }
});

export default router;
