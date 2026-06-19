import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

const SITE_URL = "https://shanemccaw.com";

const STATIC_PAGES = [
  { path: "/",                          changefreq: "monthly", priority: "1.0" },
  { path: "/about",                     changefreq: "monthly", priority: "0.8" },
  { path: "/services",                  changefreq: "monthly", priority: "0.9" },
  { path: "/services/microsoft-365",    changefreq: "monthly", priority: "0.8" },
  { path: "/services/copilot-ai",       changefreq: "monthly", priority: "0.8" },
  { path: "/services/sharepoint",       changefreq: "monthly", priority: "0.8" },
  { path: "/services/power-platform",   changefreq: "monthly", priority: "0.8" },
  { path: "/services/governance",       changefreq: "monthly", priority: "0.8" },
  { path: "/services/cloud-migration",  changefreq: "monthly", priority: "0.8" },
  { path: "/micro-offers",              changefreq: "monthly", priority: "0.8" },
  { path: "/pricing",                   changefreq: "monthly", priority: "0.8" },
  { path: "/resources",                 changefreq: "weekly",  priority: "0.7" },
  { path: "/contact",                   changefreq: "monthly", priority: "0.7" },
  { path: "/book",                      changefreq: "monthly", priority: "0.7" },
  { path: "/privacy",                   changefreq: "yearly",  priority: "0.3" },
];

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
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
  return data;
}

function toIsoDate(humanDate: string): string {
  const d = new Date(humanDate);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function generateSitemap(articlesDir: string): string {
  const today = new Date().toISOString().slice(0, 10);

  const staticEntries = STATIC_PAGES.map(
    ({ path: p, changefreq, priority }) => `  <url>
    <loc>${SITE_URL}${p}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`,
  ).join("\n\n");

  let articleEntries = "";
  if (fs.existsSync(articlesDir)) {
    const mdFiles = fs
      .readdirSync(articlesDir)
      .filter((f) => f.endsWith(".md"));

    const articleBlocks = mdFiles
      .map((file) => {
        const raw = fs.readFileSync(path.join(articlesDir, file), "utf-8");
        const fm = parseFrontmatter(raw);
        const slug = fm.slug ?? file.replace(/\.md$/, "");
        const lastmod = fm.date ? toIsoDate(fm.date) : today;
        return { slug, lastmod };
      })
      .sort((a, b) => b.lastmod.localeCompare(a.lastmod))
      .map(
        ({ slug, lastmod }) => `  <url>
    <loc>${SITE_URL}/resources/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`,
      )
      .join("\n\n");

    if (articleBlocks) {
      articleEntries = "\n\n" + articleBlocks;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

${staticEntries}${articleEntries}

</urlset>
`;
}

function sitemapPlugin(): Plugin {
  const articlesDir = path.resolve(import.meta.dirname, "src/content/articles");
  const publicDir = path.resolve(import.meta.dirname, "public");
  const sitemapPath = path.join(publicDir, "sitemap.xml");

  return {
    name: "generate-sitemap",
    buildStart() {
      const xml = generateSitemap(articlesDir);
      fs.writeFileSync(sitemapPath, xml, "utf-8");
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    sitemapPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
