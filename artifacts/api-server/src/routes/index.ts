import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminArticlesRouter from "./admin-articles";
import sharesRouter from "./shares";
import authRouter from "./auth";
import leadsRouter from "./leads";
import downloadsRouter from "./downloads";
import portalRouter from "./portal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminArticlesRouter);
router.use(sharesRouter);
router.use(authRouter);
router.use(leadsRouter);
router.use(downloadsRouter);
router.use(portalRouter);

export default router;
