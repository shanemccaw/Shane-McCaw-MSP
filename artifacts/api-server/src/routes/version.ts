import { Router, type IRouter } from "express";
import versionInfo from "../generated/version.json" with { type: "json" };

// Internal build/version stamp — distinct from the external partner
// health check at /api/msp/v1/health, which stays unmodified.
const router: IRouter = Router();

router.get("/version", (_req, res) => {
  res.json(versionInfo);
});

export default router;
