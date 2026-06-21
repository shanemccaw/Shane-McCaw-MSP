import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, usersTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  graphCredentialsPresent,
  createM365Group,
  addGroupOwner,
  getGroupSiteUrl,
  getGroupFromSiteId,
  createSiteFolder,
  listDriveItems,
  getSiteByUrl,
} from "../lib/graph";

const router: IRouter = Router();

const HUB_SITE_URL_KEY = "sharepoint_hub_site_url";
const HUB_SITE_ID_KEY = "sharepoint_hub_site_id";
const TEMPLATE_SITE_URL_KEY = "sharepoint_template_site_url";
const TEMPLATE_SITE_ID_KEY = "sharepoint_template_site_id";

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

// ─── GET template site config ─────────────────────────────────────────────────
router.get("/admin/sharepoint/template-site", requireAdmin, async (_req: Request, res: Response) => {
  const [urlRow, idRow] = await Promise.all([
    db.select().from(settingsTable).where(eq(settingsTable.key, TEMPLATE_SITE_URL_KEY)),
    db.select().from(settingsTable).where(eq(settingsTable.key, TEMPLATE_SITE_ID_KEY)),
  ]);
  res.json({
    templateSiteUrl: urlRow[0]?.value ?? null,
    templateSiteId: idRow[0]?.value ?? null,
    graphConfigured: graphCredentialsPresent(),
  });
});

// ─── PUT save template site URL ───────────────────────────────────────────────
router.put("/admin/sharepoint/template-site", requireAdmin, async (req: Request, res: Response) => {
  const { templateSiteUrl } = req.body as { templateSiteUrl?: string };
  if (!templateSiteUrl || typeof templateSiteUrl !== "string") {
    res.status(400).json({ error: "templateSiteUrl is required" });
    return;
  }

  const cleanUrl = templateSiteUrl.trim().replace(/\/$/, "");

  await db.insert(settingsTable).values({ key: TEMPLATE_SITE_URL_KEY, value: cleanUrl })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: cleanUrl, updatedAt: new Date() } });

  let siteId: string | null = null;
  if (graphCredentialsPresent()) {
    try {
      const site = await getSiteByUrl(cleanUrl);
      if (site) {
        siteId = site.id;
        await db.insert(settingsTable).values({ key: TEMPLATE_SITE_ID_KEY, value: siteId })
          .onConflictDoUpdate({ target: settingsTable.key, set: { value: siteId, updatedAt: new Date() } });
      } else {
        await db.insert(settingsTable).values({ key: TEMPLATE_SITE_ID_KEY, value: null })
          .onConflictDoUpdate({ target: settingsTable.key, set: { value: null, updatedAt: new Date() } });
      }
    } catch (err) {
      logger.warn({ err }, "Could not resolve SharePoint template site ID from URL");
    }
  }

  res.json({
    templateSiteUrl: cleanUrl,
    templateSiteId: siteId,
    graphConfigured: graphCredentialsPresent(),
  });
});

// ─── GET template drive items (root or subfolder) ─────────────────────────────
router.get("/admin/sharepoint/templates/items", requireAdmin, async (req: Request, res: Response) => {
  const folderPath = typeof req.query.folder === "string" ? req.query.folder : undefined;

  if (!graphCredentialsPresent()) {
    res.status(503).json({ error: "Graph credentials not configured", items: [] });
    return;
  }

  const [idRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, TEMPLATE_SITE_ID_KEY));
  const siteId = idRow?.value ?? null;

  if (!siteId) {
    res.status(404).json({ error: "Template site not configured", items: [] });
    return;
  }

  try {
    const raw = await listDriveItems(siteId, folderPath);
    const items = raw.map(item => ({
      driveItemId: item.id,
      name: item.name,
      webUrl: item.webUrl,
      mimeType: item.mimeType ?? null,
      folder: item.type === "folder",
      lastModifiedDateTime: item.lastModified ?? null,
    }));
    res.json({ items });
  } catch (err) {
    logger.warn({ err, siteId, folderPath }, "listDriveItems for templates failed");
    res.status(502).json({ error: "Could not fetch template files", items: [] });
  }
});

// ─── POST add Shane as owner of existing client SharePoint site ───────────────
router.post("/admin/clients/:id/sharepoint/add-owner", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  const ownerUpn = process.env.SHAREPOINT_OWNER_UPN;
  if (!ownerUpn) {
    res.status(503).json({ error: "SHAREPOINT_OWNER_UPN is not configured." });
    return;
  }

  if (!graphCredentialsPresent()) {
    res.status(503).json({ error: "Graph credentials not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, and GRAPH_CLIENT_SECRET." });
    return;
  }

  const [client] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }

  if (!client.sharepointSiteUrl && !client.sharepointSiteId) {
    res.status(400).json({ error: "No SharePoint site linked to this client." });
    return;
  }

  // Resolve the M365 group ID using a three-step fallback chain:
  // 1. Stored group ID (written during provisioning — fastest, works before site is ready)
  // 2. Site ID already stored on the client record → Graph group lookup
  // 3. Site URL → resolve site ID via Graph → Graph group lookup (handles older clients)
  let groupId: string | null = null;

  const [storedGroupRow] = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, `m365_group_id_${id}`));
  if (storedGroupRow?.value) {
    groupId = storedGroupRow.value;
  }

  if (!groupId && client.sharepointSiteId) {
    const g = await getGroupFromSiteId(client.sharepointSiteId);
    if (g) groupId = g.id;
  }

  if (!groupId && client.sharepointSiteUrl) {
    const site = await getSiteByUrl(client.sharepointSiteUrl);
    if (site) {
      const g = await getGroupFromSiteId(site.id);
      if (g) groupId = g.id;
    }
  }

  if (!groupId) {
    res.status(502).json({ error: "Could not resolve M365 group for this client's site. The site may not be group-connected." });
    return;
  }

  const added = await addGroupOwner(groupId, ownerUpn);
  if (!added) {
    res.status(502).json({ error: "addGroupOwner call failed. Check server logs for details." });
    return;
  }

  res.json({ ok: true });
});

// ─── PATCH client SharePoint link (manual override) ───────────────────────────
router.patch("/admin/clients/:id/sharepoint", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

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

  const [updated] = await db.update(usersTable)
    .set({ sharepointSiteUrl: url, sharepointSiteId: siteId })
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Client not found" }); return; }

  res.json({ ok: true, sharepointSiteUrl: url, sharepointSiteId: siteId });
});

// ─── POST provision SharePoint site for a client (async trigger) ──────────────
router.post("/admin/clients/:id/sharepoint/provision", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  if (!graphCredentialsPresent()) {
    res.status(503).json({ error: "Graph credentials not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, and GRAPH_CLIENT_SECRET." });
    return;
  }

  const [client] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }

  if (client.sharepointSiteUrl) {
    res.json({ ok: true, alreadyProvisioned: true, sharepointSiteUrl: client.sharepointSiteUrl });
    return;
  }

  res.json({ ok: true, provisioning: true, message: "SharePoint site provisioning started in background." });

  void (async () => {
    try {
      await provisionClientSite(id, client.company ?? client.name ?? client.email, req.log);
    } catch (err) {
      logger.error({ err, clientId: id }, "Manual SharePoint provisioning failed");
    }
  })();
});

export async function provisionClientSite(
  clientId: number,
  clientName: string,
  log?: { warn: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void },
): Promise<void> {
  const warn = log?.warn.bind(log) ?? logger.warn.bind(logger);
  const info = log?.info.bind(log) ?? logger.info.bind(logger);

  if (!graphCredentialsPresent()) {
    warn({ clientId }, "SharePoint provisioning skipped — Graph credentials missing");
    return;
  }

  // Idempotency guard: skip if the client already has a linked SharePoint site
  const [existing] = await db.select({ sharepointSiteUrl: usersTable.sharepointSiteUrl })
    .from(usersTable).where(eq(usersTable.id, clientId));
  if (existing?.sharepointSiteUrl) {
    info({ clientId, siteUrl: existing.sharepointSiteUrl }, "SharePoint provisioning skipped — site already exists");
    return;
  }

  const mailNickname = `smc-client-${clientId}-${Date.now()}`;
  const displayName = `SMC — ${clientName}`.slice(0, 120);

  const group = await createM365Group(displayName, mailNickname);
  if (!group) {
    warn({ clientId, displayName }, "SharePoint provisioning: createM365Group returned null");
    return;
  }

  // Persist group ID in settings so the manual add-owner endpoint can use it
  // without an extra Graph lookup, even before the SharePoint site is ready.
  await db.insert(settingsTable).values({ key: `m365_group_id_${clientId}`, value: group.id })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: group.id, updatedAt: new Date() } });

  // Add Shane as group owner so he has full access from SharePoint/Teams.
  // M365 groups are eventually consistent, so retry up to 3 times with 5 s delays.
  const ownerUpn = process.env.SHAREPOINT_OWNER_UPN;
  if (ownerUpn) {
    let added = false;
    for (let attempt = 1; attempt <= 3 && !added; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 5000));
      added = await addGroupOwner(group.id, ownerUpn);
    }
    if (!added) {
      warn({ clientId, groupId: group.id, ownerUpn }, "SharePoint provisioning: addGroupOwner failed after 3 attempts (non-fatal, continuing)");
    }
  } else {
    warn({ clientId }, "SharePoint provisioning: SHAREPOINT_OWNER_UPN not set — skipping owner assignment");
  }

  // Poll for site URL (M365 can take 15-60 seconds to provision)
  let siteInfo: { id: string; webUrl: string } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    siteInfo = await getGroupSiteUrl(group.id);
    if (siteInfo) break;
  }

  if (!siteInfo) {
    warn({ clientId, groupId: group.id }, "SharePoint provisioning: site URL not available after polling");
    return;
  }

  // Save to DB immediately so the link shows up on the client profile
  await db.update(usersTable)
    .set({ sharepointSiteUrl: siteInfo.webUrl, sharepointSiteId: siteInfo.id })
    .where(eq(usersTable.id, clientId));

  // Pre-create standard folders
  const folders = ["Deliverables", "Meetings", "Contracts", "Scripts", "Invoices"];
  for (const folder of folders) {
    try {
      await createSiteFolder(siteInfo.id, "/", folder);
    } catch (err) {
      warn({ err, folder, siteId: siteInfo.id }, "SharePoint provisioning: folder creation failed (non-fatal)");
    }
  }

  info({ clientId, siteUrl: siteInfo.webUrl }, "SharePoint site provisioned for client");
}

export default router;
