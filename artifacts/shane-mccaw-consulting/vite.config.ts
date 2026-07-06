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
  { path: "/quick-wins",              changefreq: "monthly", priority: "0.8" },
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

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const QUIZ_ROUTE_META = [
  {
    routePath: "m365-health-quiz",
    title: "Microsoft 365 Health Check | Free Tenant Assessment | Shane McCaw Consulting",
    description: "Take our free M365 tenant health assessment. Score your security posture, identity, governance, and DLP in 5 minutes — and receive a personalised PDF report by email.",
    image: "og-image-m365-health-quiz.png",
    url: `${SITE_URL}/m365-health-quiz`,
  },
  {
    routePath: "governance-maturity-quiz",
    title: "Microsoft 365 Governance Maturity Assessment | Shane McCaw Consulting",
    description: "How mature is your M365 governance framework? Take our free assessment to benchmark your policies, lifecycle management, and compliance posture — with a personalised PDF report.",
    image: "og-image-governance-quiz.png",
    url: `${SITE_URL}/governance-maturity-quiz`,
  },
  {
    routePath: "migration-readiness-quiz",
    title: "Cloud Migration Readiness Assessment | Microsoft 365 | Shane McCaw Consulting",
    description: "Is your organisation ready to migrate to Microsoft 365? Take our free readiness quiz and receive a personalised migration roadmap from a 30-year Microsoft ecosystem veteran.",
    image: "og-image-migration-quiz.png",
    url: `${SITE_URL}/migration-readiness-quiz`,
  },
  {
    routePath: "power-platform-quiz",
    title: "Power Platform Maturity Assessment | Free Quiz | Shane McCaw Consulting",
    description: "How mature is your Power Platform practice? Take our free assessment and receive a personalised PDF report with a tailored service recommendation from a 30-year Microsoft expert.",
    image: "og-image-power-platform-quiz.png",
    url: `${SITE_URL}/power-platform-quiz`,
  },
  {
    routePath: "security-compliance-quiz",
    title: "Microsoft 365 Security & Compliance Assessment | Shane McCaw Consulting",
    description: "How secure is your Microsoft 365 environment? Take our free security posture quiz covering Defender, Conditional Access, DLP, and sensitivity labels — with a PDF report included.",
    image: "og-image-security-quiz.png",
    url: `${SITE_URL}/security-compliance-quiz`,
  },
  {
    routePath: "sharepoint-readiness-quiz",
    title: "SharePoint Architecture & IA Assessment | Free Quiz | Shane McCaw Consulting",
    description: "How well-architected is your SharePoint environment? Answer 10 expert questions across 5 dimensions and receive a personalised maturity report from a NASA-certified Microsoft 365 Architect.",
    image: "og-image-sharepoint-quiz.png",
    url: `${SITE_URL}/sharepoint-readiness-quiz`,
  },
  {
    routePath: "teams-maturity-quiz",
    title: "Microsoft Teams Maturity Assessment | Free Quiz | Shane McCaw Consulting",
    description: "Is your organisation getting full value from Microsoft Teams? Take our free maturity quiz assessing governance, adoption, and technical configuration — PDF report emailed to you.",
    image: "og-image-teams-quiz.png",
    url: `${SITE_URL}/teams-maturity-quiz`,
  },
];

function perRouteOgPlugin(): Plugin {
  return {
    name: "per-route-og-meta",
    apply: "build" as const,
    closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "dist/public");
      const indexPath = path.join(outDir, "index.html");
      if (!fs.existsSync(indexPath)) return;

      let template = fs.readFileSync(indexPath, "utf-8");

      for (const route of QUIZ_ROUTE_META) {
        const routeDir = path.join(outDir, route.routePath);
        fs.mkdirSync(routeDir, { recursive: true });

        let html = template;
        const t = escapeAttr(route.title);
        const d = escapeAttr(route.description);
        const img = `${SITE_URL}/${route.image}`;

        html = html.replace(/(<title>)[^<]*(<\/title>)/, `$1${t}$2`);
        html = html.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/,   `$1${d}$2`);
        html = html.replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/,  `$1${t}$2`);
        html = html.replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/,`$1${d}$2`);
        html = html.replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/,    `$1${escapeAttr(route.url)}$2`);
        html = html.replace(/(<meta\s+property="og:image"\s+content=")[^"]*(")/,  `$1${img}$2`);
        html = html.replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,       `$1${t}$2`);
        html = html.replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,  `$1${d}$2`);
        html = html.replace(/(<meta\s+name="twitter:image"\s+content=")[^"]*(")/,        `$1${img}$2`);

        fs.writeFileSync(path.join(routeDir, "index.html"), html, "utf-8");
      }
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    sitemapPlugin(),
    perRouteOgPlugin(),
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
