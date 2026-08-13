import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { REQUIRED_MT_SCOPES } from "../lib/graph";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

// ── GET /api/public/consent-scopes ──────────────────────────────────────────
// Public endpoint — no auth required. Returns the real Graph application
// permissions requested by the multi-tenant App Registration (#433), so the
// marketing site never carries its own hardcoded, drift-prone copy of them.

router.get("/public/consent-scopes", (_req: Request, res: Response) => {
  try {
    res.json(REQUIRED_MT_SCOPES);
  } catch (err) {
    log.error({ err }, "Failed to return consent scopes");
    res.status(500).json({ error: "Failed to fetch consent scopes" });
  }
});

export default router;
