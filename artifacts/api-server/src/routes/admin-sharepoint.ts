import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  graphCredentialsPresent,
  createM365Group,
  getGroupSiteUrl,
  createSiteFolder,
  listDriveItems,
  getSiteByUrl,
} from "../lib/graph";

const router: IRouter = Router();

const HUB_SITE_URL_KEY = "sharepoint_hub_site_url";
const HUB_SITE_ID_KEY = "sharepoint_hub_site_id";

// ─── GET hub site config ──────────────────────────────────────────────────────
router.get("/admin/sharepoint/hub-config", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, HUB_SITE_URL_KEY));
  const idRows = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, HUB_SITE_ID_KEY));
  res.json({
    hubSiteUrl: rows[0]?.value ?? null,
    hubSiteId: idRows[0]?.value ?? null,
    graphConfigured: graphCredentialsPresent(),
  });
});

// ─── POST save hub site URL (resolve to site ID via Graph) ───────────────────
router.post("/admin/sharepoint/hub-config", requireAdmin, async (req: Request, res: Response) => {
  const { hubSiteUrl } = req.body as { hubSiteUrl?: string };
  if (!hubSiteUrl || typeof hubSiteUrl !== "string") {
    res.status(400).json({ error: "hubSiteUrl is required" });
    return;
  }

  const cleanUrl = hubSiteUrl.trim().replace(/\/$/, "");

  await db.insert(settingsTable).values({ key: HUB_SITE_URL_KEY, value: cleanUrl })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: cleanUrl, updatedAt: new Date() } });

  let siteId: string | null = null;
  if (graphCredentialsPresent()) {
    try {
      const site = await getSiteByUrl(cleanUrl);
      if (site) {
        siteId = site.id;
        await db.insert(settingsTable).values({ key: HUB_SITE_ID_KEY, value: siteId })
          .onConflictDoUpdate({ target: settingsTable.key, set: { value: siteId, updatedAt: new Date() } });
      }
    } catch (err) {
      logger.warn({ err }, "Could not resolve SharePoint hub site ID from URL");
    }
  }

  res.json({ ok: true, hubSiteUrl: cleanUrl, hubSiteId: siteId });
});

// ─── GET hub drive items (root or subfolder) ──────────────────────────────────
router.get("/admin/sharepoint/hub/items", requireAdmin, async (req: Request, res: Response) => {
  const folderPath = typeof req.query.path === "string" ? req.query.path : undefined;

  if (!graphCredentialsPresent()) {
    res.status(503).json({ error: "Graph credentials not configured", items: [] });
    return;
  }

  const idRows = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, HUB_SITE_ID_KEY));
  const siteId = idRows[0]?.value ?? null;

  if (!siteId) {
    res.status(404).json({ error: "Hub site not configured", items: [] });
    return;
  }

  try {
    const items = await listDriveItems(siteId, folderPath);
    res.json({ items });
  } catch (err) {
    logger.warn({ err, siteId, folderPath }, "listDriveItems failed");
    res.status(502).json({ error: "Could not fetch SharePoint items", items: [] });
  }
});

// ─── PATCH project SharePoint link (manual override) ─────────────────────────
router.patch("/admin/projects/:id/sharepoint", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const { sharepointSiteUrl } = req.body as { sharepointSiteUrl?: string };
  const url = sharepointSiteUrl ? sharepointSiteUrl.trim() || null : null;

  let siteId: string | null = null;
  if (url && graphCredentialsPresent()) {
    try {
      const site = await getSiteByUrl(url);
      if (site) siteId = site.id;
    } catch {
      // non-fatal
    }
  }

  const [updated] = await db.update(projectsTable)
    .set({ sharepointSiteUrl: url, sharepointSiteId: siteId })
    .where(eq(projectsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Project not found" }); return; }

  res.json({ ok: true, sharepointSiteUrl: url, sharepointSiteId: siteId });
});

// ─── POST provision SharePoint site for a project (async trigger) ─────────────
router.post("/admin/projects/:id/sharepoint/provision", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  if (!graphCredentialsPresent()) {
    res.status(503).json({ error: "Graph credentials not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, and GRAPH_CLIENT_SECRET." });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  if (project.sharepointSiteUrl) {
    res.json({ ok: true, alreadyProvisioned: true, sharepointSiteUrl: project.sharepointSiteUrl });
    return;
  }

  res.json({ ok: true, provisioning: true, message: "SharePoint site provisioning started in background." });

  void (async () => {
    try {
      await provisionProjectSite(id, project.title, req.log);
    } catch (err) {
      logger.error({ err, projectId: id }, "Manual SharePoint provisioning failed");
    }
  })();
});

export async function provisionProjectSite(
  projectId: number,
  projectTitle: string,
  log?: { warn: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void },
): Promise<void> {
  const warn = log?.warn.bind(log) ?? logger.warn.bind(logger);
  const info = log?.info.bind(log) ?? logger.info.bind(logger);

  if (!graphCredentialsPresent()) {
    warn({ projectId }, "SharePoint provisioning skipped — Graph credentials missing");
    return;
  }

  const mailNickname = `smc-project-${projectId}-${Date.now()}`;
  const displayName = `SMC — ${projectTitle}`.slice(0, 120);

  const group = await createM365Group(displayName, mailNickname);
  if (!group) {
    warn({ projectId, displayName }, "SharePoint provisioning: createM365Group returned null");
    return;
  }

  // Poll for site URL (M365 can take 15-60 seconds to provision)
  let siteInfo: { id: string; webUrl: string } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    siteInfo = await getGroupSiteUrl(group.id);
    if (siteInfo) break;
  }

  if (!siteInfo) {
    warn({ projectId, groupId: group.id }, "SharePoint provisioning: site URL not available after polling");
    return;
  }

  // Save to DB immediately so the link shows up
  await db.update(projectsTable)
    .set({ sharepointSiteUrl: siteInfo.webUrl, sharepointSiteId: siteInfo.id })
    .where(eq(projectsTable.id, projectId));

  // Pre-create standard folders
  const folders = ["Deliverables", "Meetings", "Contracts", "Scripts"];
  for (const folder of folders) {
    try {
      await createSiteFolder(siteInfo.id, "/", folder);
    } catch (err) {
      warn({ err, folder, siteId: siteInfo.id }, "SharePoint provisioning: folder creation failed (non-fatal)");
    }
  }

  info({ projectId, siteUrl: siteInfo.webUrl }, "SharePoint site provisioned");
}

export default router;
