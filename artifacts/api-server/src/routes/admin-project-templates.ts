import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

router.all("/admin/project-templates", (_req: Request, res: Response) => {
  res.status(404).json({ error: "project_templates has been removed. Use workflow templates instead." });
});

router.all("/admin/project-templates/:id", (_req: Request, res: Response) => {
  res.status(404).json({ error: "project_templates has been removed. Use workflow templates instead." });
});

router.all("/admin/project-templates/:id/tasks", (_req: Request, res: Response) => {
  res.status(404).json({ error: "project_templates has been removed. Use workflow templates instead." });
});

router.all("/admin/project-templates/:id/tasks/:taskId", (_req: Request, res: Response) => {
  res.status(404).json({ error: "project_templates has been removed. Use workflow templates instead." });
});

export default router;
