import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminArticlesRouter from "./admin-articles";
import sharesRouter from "./shares";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminArticlesRouter);
router.use(sharesRouter);

export default router;
