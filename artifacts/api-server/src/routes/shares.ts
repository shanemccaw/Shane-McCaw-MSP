import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const SHARES_FILE = process.env.SHARES_FILE
  ? path.resolve(process.env.SHARES_FILE)
  : path.resolve("../shane-mccaw-consulting/src/content/shares.json");

const VALID_PLATFORMS = ["linkedin", "x"] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

interface ShareEntry {
  slug: string;
  platform: Platform;
  timestamp: string;
}

interface ShareCounts {
  [slug: string]: {
    linkedin: number;
    x: number;
    total: number;
  };
}

function readEntries(): ShareEntry[] {
  try {
    if (!fs.existsSync(SHARES_FILE)) return [];
    const raw = fs.readFileSync(SHARES_FILE, "utf-8");
    return JSON.parse(raw) as ShareEntry[];
  } catch {
    return [];
  }
}

function writeEntries(entries: ShareEntry[]): void {
  const dir = path.dirname(SHARES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SHARES_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

function toCounts(entries: ShareEntry[]): ShareCounts {
  const counts: ShareCounts = {};
  for (const e of entries) {
    if (!counts[e.slug]) counts[e.slug] = { linkedin: 0, x: 0, total: 0 };
    counts[e.slug][e.platform]++;
    counts[e.slug].total++;
  }
  return counts;
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(500).json({ error: "ADMIN_PASSWORD not configured" });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${adminPassword}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.post("/shares", (req: Request, res: Response) => {
  const { slug, platform } = req.body as { slug?: string; platform?: string };

  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(400).json({ error: "Invalid or missing slug" });
    return;
  }
  if (!platform || !VALID_PLATFORMS.includes(platform as Platform)) {
    res.status(400).json({ error: "platform must be 'linkedin' or 'x'" });
    return;
  }

  try {
    const entries = readEntries();
    entries.push({ slug, platform: platform as Platform, timestamp: new Date().toISOString() });
    writeEntries(entries);
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to record share" });
  }
});

router.get("/shares", authMiddleware, (_req: Request, res: Response) => {
  try {
    const entries = readEntries();
    const counts = toCounts(entries);
    const total = entries.length;
    res.json({ counts, total });
  } catch {
    res.status(500).json({ error: "Failed to read shares" });
  }
});

export default router;
