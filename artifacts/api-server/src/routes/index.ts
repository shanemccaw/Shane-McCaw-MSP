import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminArticlesRouter from "./admin-articles";
import adminServicesRouter from "./admin-services";
import adminWorkflowTemplatesRouter from "./admin-workflow-templates";
import adminProjectTemplatesRouter from "./admin-project-templates";
import adminContractTemplatesRouter from "./admin-contract-templates";
import sharesRouter from "./shares";
import authRouter from "./auth";
import leadsRouter from "./leads";
import downloadsRouter from "./downloads";
import portalRouter from "./portal";
import publicServicesRouter from "./public-services";
import publicEngagementProjectsRouter from "./public-engagement-projects";
import adminEngagementProjectsRouter from "./admin-engagement-projects";
import adminAiDraftRouter from "./admin-ai-draft";
import adminOverviewRouter from "./admin-overview";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminArticlesRouter);
router.use(adminServicesRouter);
router.use(adminWorkflowTemplatesRouter);
router.use(adminProjectTemplatesRouter);
router.use(adminContractTemplatesRouter);
router.use(adminEngagementProjectsRouter);
router.use(adminAiDraftRouter);
router.use(adminOverviewRouter);
router.use(sharesRouter);
router.use(authRouter);
router.use(leadsRouter);
router.use(downloadsRouter);
router.use(publicServicesRouter);
router.use(publicEngagementProjectsRouter);
router.use(portalRouter);

export default router;
