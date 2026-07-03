import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const GENERATED_IMAGES_DIR = path.join(UPLOADS_BASE, "generated-images");

fs.mkdirSync(GENERATED_IMAGES_DIR, { recursive: true });
logger.info({ dir: GENERATED_IMAGES_DIR }, "generated-images: directory ready");

router.get("/uploads/generated-images/:filename", (req: Request, res: Response) => {
  const filename = path.basename(String(req.params.filename ?? ""));
  if (!filename || !filename.endsWith(".png")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = path.join(GENERATED_IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Image not found" });
    return;
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(filePath);
});

export { GENERATED_IMAGES_DIR };
export default router;
