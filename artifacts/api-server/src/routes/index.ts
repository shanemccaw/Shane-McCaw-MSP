import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminArticlesRouter from "./admin-articles";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminArticlesRouter);

export default router;
