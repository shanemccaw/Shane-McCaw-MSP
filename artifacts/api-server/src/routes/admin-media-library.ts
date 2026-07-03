import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const GENERATED_IMAGES_DIR = path.join(UPLOADS_BASE, "generated-images");
const MEDIA_LIBRARY_DIR = path.join(UPLOADS_BASE, "media-library");

fs.mkdirSync(MEDIA_LIBRARY_DIR, { recursive: true });
logger.info({ dir: MEDIA_LIBRARY_DIR }, "media-library: directory ready");

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_LIBRARY_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
    const unique = `${Date.now()}-${safe}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (jpg, jpeg, png, gif, webp, svg)"));
    }
  },
});

interface MediaItem {
  filename: string;
  url: string;
  source: "generated" | "uploaded";
  size: number;
  createdAt: string;
}

function readDirItems(dir: string, source: "generated" | "uploaded", urlPrefix: string): MediaItem[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXTENSIONS.has(ext);
    })
    .map(f => {
      const fullPath = path.join(dir, f);
      let size = 0;
      let createdAt = new Date().toISOString();
      try {
        const stat = fs.statSync(fullPath);
        size = stat.size;
        createdAt = stat.birthtime.toISOString();
      } catch {
        // ignore
      }
      return { filename: f, url: `${urlPrefix}/${f}`, source, size, createdAt };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── GET /api/admin/media-library ────────────────────────────────────────────
// Returns all images: generated (from generate_image nodes) + manually uploaded

router.get("/admin/media-library", requireAdmin, (_req: Request, res: Response) => {
  try {
    const generated = readDirItems(GENERATED_IMAGES_DIR, "generated", "/api/uploads/generated-images");
    const uploaded = readDirItems(MEDIA_LIBRARY_DIR, "uploaded", "/api/uploads/media-library");
    const all = [...uploaded, ...generated].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(all);
  } catch (err) {
    logger.error({ err }, "media-library: failed to list images");
    res.status(500).json({ error: "Failed to list media library" });
  }
});

// ─── POST /api/admin/media-library/upload ────────────────────────────────────
// Accepts a single image file, stores in media-library dir

router.post(
  "/admin/media-library/upload",
  requireAdmin,
  (req: Request, res: Response, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    const item: MediaItem = {
      filename: req.file.filename,
      url: `/api/uploads/media-library/${req.file.filename}`,
      source: "uploaded",
      size: req.file.size,
      createdAt: new Date().toISOString(),
    };
    logger.info({ filename: req.file.filename }, "media-library: image uploaded");
    res.status(201).json(item);
  },
);

// ─── DELETE /api/admin/media-library/:filename ────────────────────────────────
// Removes a manually-uploaded image (generated images are not deletable here)

router.delete("/admin/media-library/:filename", requireAdmin, (req: Request, res: Response) => {
  const filename = path.basename(String(req.params.filename ?? ""));
  if (!filename) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(MEDIA_LIBRARY_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found in media library" });
    return;
  }
  try {
    fs.unlinkSync(filePath);
    logger.info({ filename }, "media-library: image deleted");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, filename }, "media-library: failed to delete image");
    res.status(500).json({ error: "Failed to delete image" });
  }
});

// ─── GET /api/uploads/media-library/:filename ────────────────────────────────
// Serves uploaded images

router.get("/uploads/media-library/:filename", (req: Request, res: Response) => {
  const filename = path.basename(String(req.params.filename ?? ""));
  if (!filename) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(MEDIA_LIBRARY_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Image not found" });
    return;
  }
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  res.setHeader("Content-Type", mimeMap[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(filePath);
});

export default router;
