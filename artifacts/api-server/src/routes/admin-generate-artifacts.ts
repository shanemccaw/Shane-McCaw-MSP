import { Router } from "express";
import { db, projectsTable, kanbanTasksTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { uploadFileToSharePoint, graphCredentialsPresent, ensureSharePointFolderAtRoot } from "../lib/graph";
import { logger } from "../lib/logger";
import { getPrompt } from "../lib/prompt-loader.ts";

const log = logger.child({ channel: "admin.content" });

const router = Router();

const navy  = rgb(0.039, 0.145, 0.251);
const blue  = rgb(0,     0.471, 0.831);
const white = rgb(1, 1, 1);

function wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function dt(page: PDFPage, text: string, x: number, y: number, opts: {
  font: PDFFont; size: number; color: ReturnType<typeof rgb>;
}) {
  page.drawText(text, { x, y, font: opts.font, size: opts.size, color: opts.color });
}

async function generateArtifactPdf(
  artifactName: string,
  content: string,
  projectTitle: string,
  clientName: string,
  generatedAt: Date,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageW  = 595;
  const pageH  = 842;
  const margin = 55;
  const bodyW  = pageW - margin * 2;

  const addPage = (): PDFPage => {
    const p = pdfDoc.addPage([pageW, pageH]);
    p.drawRectangle({ x: 0, y: pageH - 52, width: pageW, height: 52, color: navy });
    dt(p, "Shane McCaw Consulting", margin, pageH - 22, { font: bold, size: 14, color: white });
    dt(p, "Lead Microsoft 365 Architect", margin, pageH - 38, { font: regular, size: 9, color: rgb(0.7, 0.8, 0.9) });
    p.drawRectangle({ x: 0, y: 0, width: pageW, height: 28, color: navy });
    dt(p, `${projectTitle}  |  ${clientName}`, margin, 10, { font: regular, size: 7, color: rgb(0.6, 0.7, 0.8) });
    const dateStr = generatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    dt(p, `Generated ${dateStr}`, pageW - 160, 10, { font: regular, size: 7, color: rgb(0.5, 0.6, 0.7) });
    return p;
  };

  let page = addPage();
  let y = pageH - 72;

  dt(page, artifactName, margin, y, { font: bold, size: 15, color: navy });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1.5, color: blue });
  y -= 20;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();

    if (y < 50) {
      page = addPage();
      y = pageH - 72;
    }

    if (line.startsWith("# ")) {
      const text = line.slice(2).trim();
      y -= 6;
      dt(page, text, margin, y, { font: bold, size: 13, color: navy });
      y -= 4;
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.8, color: blue });
      y -= 14;
    } else if (line.startsWith("## ")) {
      const text = line.slice(3).trim();
      y -= 4;
      dt(page, text, margin, y, { font: bold, size: 11, color: blue });
      y -= 14;
    } else if (line.startsWith("### ")) {
      const text = line.slice(4).trim();
      dt(page, text, margin, y, { font: bold, size: 10, color: navy });
      y -= 13;
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const text = line.slice(2).trim();
      const wrapped = wrapText(text, bodyW - 14, regular, 9);
      for (let i = 0; i < wrapped.length; i++) {
        if (y < 50) { page = addPage(); y = pageH - 72; }
        if (i === 0) dt(page, "•", margin, y, { font: bold, size: 9, color: blue });
        dt(page, wrapped[i], margin + 12, y, { font: regular, size: 9, color: navy });
        y -= 12;
      }
    } else if (line === "" || line === "---") {
      y -= 6;
    } else {
      const stripped = line.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
      const wrapped = wrapText(stripped, bodyW, regular, 9);
      for (const wl of wrapped) {
        if (y < 50) { page = addPage(); y = pageH - 72; }
        dt(page, wl, margin, y, { font: regular, size: 9, color: navy });
        y -= 13;
      }
      y -= 3;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

type ProjectRow = typeof projectsTable.$inferSelect;
type TaskRow    = typeof kanbanTasksTable.$inferSelect;

function buildProjectContext(
  project: Pick<ProjectRow, "title" | "description" | "phase">,
  tasks: TaskRow[],
  clientName: string,
): string {
  return [
    `Project: ${project.title}`,
    project.description ? `Description: ${project.description}` : null,
    `Client: ${clientName}`,
    `Phase: ${project.phase ?? "N/A"}`,
    "",
    "Completed Tasks:",
    ...tasks.map(t => {
      const meta = (t.taskMetadata ?? {}) as Record<string, unknown>;
      const parts = [`- [${t.taskType ?? "task"}] ${t.title}`];
      if (t.groupName) parts.push(`  Group: ${t.groupName}`);
      if (t.description) parts.push(`  Description: ${t.description}`);
      if (t.completionStatus) parts.push(`  Completion Status: ${t.completionStatus}`);
      if (t.completionNotes) parts.push(`  Completion Notes: ${t.completionNotes}`);

      const instructions = Array.isArray(meta.instructions) ? (meta.instructions as string[]) : [];
      if (instructions.length > 0) parts.push(`  Instructions: ${instructions.join("; ")}`);

      const checklist = Array.isArray(meta.checklist)
        ? (meta.checklist as Array<{ id: string; label: string }>)
        : [];
      const checklistState = (meta.checklistState ?? {}) as Record<string, boolean>;
      if (checklist.length > 0) {
        const done = checklist.filter(i => checklistState[i.id]).length;
        parts.push(`  Checklist (${done}/${checklist.length} completed):`);
        for (const item of checklist) {
          parts.push(`    [${checklistState[item.id] ? "x" : " "}] ${item.label}`);
        }
      }

      const checklistItemData = (meta.checklistItemData ?? {}) as Record<string, Record<string, unknown>>;
      const closureEntries = Object.entries(checklistItemData);
      if (closureEntries.length > 0) {
        parts.push(`  Captured Closure Data:`);
        for (const [itemId, data] of closureEntries) {
          const label = checklist.find(i => i.id === itemId)?.label ?? itemId;
          const flat = Object.entries(data)
            .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(", ");
          parts.push(`    ${label}: ${flat}`);
        }
      }

      for (const field of [
        "postureSummary", "findingsSummary", "outputSummary",
        "riskLevel", "remediationSummary", "recommendation",
      ] as const) {
        if (typeof meta[field] === "string" && meta[field]) {
          const label = field.replace(/([A-Z])/g, " $1").trim();
          parts.push(`  ${label}: ${meta[field] as string}`);
        }
      }

      const artifactsProduced = Array.isArray(meta.artifactsProduced) ? (meta.artifactsProduced as string[]) : [];
      if (artifactsProduced.length > 0) parts.push(`  Artifacts Produced: ${artifactsProduced.join(", ")}`);
      const clientDeliverables = Array.isArray(meta.clientDeliverables) ? (meta.clientDeliverables as string[]) : [];
      if (clientDeliverables.length > 0) parts.push(`  Client Deliverables: ${clientDeliverables.join(", ")}`);
      const uploadedArtifacts = Array.isArray(meta.uploadedArtifacts) ? (meta.uploadedArtifacts as string[]) : [];
      if (uploadedArtifacts.length > 0) parts.push(`  Uploaded Files: ${uploadedArtifacts.join(", ")}`);

      return parts.join("\n");
    }),
  ].filter(Boolean).join("\n");
}

const AI_PROMPT_DEFAULT = `You are a senior Microsoft 365 consultant. Generate a professional project artifact document in Markdown format.

Project Context:
{{projectContext}}

Generate the artifact: "{{artifactName}}"

Requirements:
- Use proper Markdown headings (##, ###) to structure the document
- Be professional, detailed, and specific to the project context
- Include all relevant sections for this type of document
- Use bullet points for lists
- Length: 400-800 words
- Do NOT include a top-level title (# heading) — that will be added automatically
- Start directly with the first section heading (## ...)`;

async function buildArtifactPrompt(artifactName: string, projectContext: string): Promise<string> {
  const template = await getPrompt("artifact-generator", AI_PROMPT_DEFAULT);
  return template
    .replace("{{artifactName}}", artifactName)
    .replace("{{projectContext}}", projectContext);
}

// ── Shared pre-flight helper ───────────────────────────────────────────────
async function loadProjectAndClient(projectId: number): Promise<
  | { ok: false; status: number; body: object }
  | { ok: true; project: ProjectRow; tasks: TaskRow[]; clientName: string; sharepointSiteId: string }
> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { ok: false, status: 404, body: { error: "Project not found" } };

  const tasks = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.projectId, projectId));
  if (tasks.length === 0) return { ok: false, status: 400, body: { error: "No tasks found for this project" } };

  if (!graphCredentialsPresent()) {
    return {
      ok: false, status: 503,
      body: {
        error: "Microsoft Graph credentials are not configured. Set GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, and GRAPH_TENANT_ID in Replit Secrets.",
        code: "GRAPH_CREDENTIALS_MISSING",
      },
    };
  }

  let clientName = "Client";
  let sharepointSiteId: string | null = null;
  if (project.clientUserId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, project.clientUserId)).limit(1);
    if (user) {
      clientName = user.company ?? user.name ?? user.email ?? "Client";
      sharepointSiteId = user.sharepointSiteId ?? null;
    }
  }

  if (!sharepointSiteId) {
    return {
      ok: false, status: 503,
      body: {
        error: "The client does not have a SharePoint site ID configured. Edit the client profile in the CRM to add it.",
        code: "SHAREPOINT_SITE_ID_MISSING",
      },
    };
  }

  return { ok: true, project, tasks, clientName, sharepointSiteId };
}

function collectArtifactNames(tasks: TaskRow[]): Set<string> {
  const names = new Set<string>();
  for (const task of tasks) {
    const meta = task.taskMetadata as Record<string, unknown> | null;
    if (meta) {
      for (const field of ["artifactsProduced", "clientDeliverables"] as const) {
        if (Array.isArray(meta[field])) {
          for (const name of meta[field] as string[]) {
            if (typeof name === "string" && name.trim()) names.add(name.trim());
          }
        }
      }
    }
  }
  return names;
}

const GENERATED_ARTIFACTS_FOLDER = "Generated Artifacts";

// ── 1. Original: generate-artifacts (full draft + PDF + upload in one step) ─
router.post(
  "/admin/projects/:projectId/generate-artifacts",
  requireAdmin,
  async (req, res) => {
    const projectId = parseInt(String(req.params.projectId), 10);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

    const singleArtifactName: string | undefined =
      typeof req.body?.artifactName === "string" && req.body.artifactName.trim()
        ? req.body.artifactName.trim()
        : undefined;

    const loaded = await loadProjectAndClient(projectId);
    if (!loaded.ok) { res.status(loaded.status).json(loaded.body); return; }
    const { project, tasks, clientName, sharepointSiteId } = loaded;

    const incomplete = tasks.filter(t => t.column !== "completed");
    if (incomplete.length > 0 && !singleArtifactName) {
      res.status(400).json({
        error: `${incomplete.length} task${incomplete.length === 1 ? "" : "s"} not yet completed. All tasks must be in the Completed column.`,
      });
      return;
    }

    const allFromTasks = collectArtifactNames(tasks);
    if (allFromTasks.size === 0 && !singleArtifactName) {
      res.status(400).json({
        error: "No artifacts are defined in the project tasks. Add artifact names to the 'Artifacts Produced' or 'Client Deliverables' fields on each task before generating.",
        code: "NO_ARTIFACTS_DEFINED",
      });
      return;
    }

    const allArtifactNames: Set<string> = singleArtifactName
      ? new Set([singleArtifactName])
      : allFromTasks;

    const projectContext = buildProjectContext(project, tasks, clientName);

    await ensureSharePointFolderAtRoot(sharepointSiteId, GENERATED_ARTIFACTS_FOLDER);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      const r = res as unknown as { flush?: () => void };
      if (typeof r.flush === "function") r.flush();
    };

    const generatedAt = new Date();
    const results: Array<{ artifactName: string; sharepointUrl: string; generatedAt: string }> = [];
    const errors: string[] = [];
    const total = allArtifactNames.size;
    let count = 0;

    for (const artifactName of allArtifactNames) {
      count++;
      sendEvent({ type: "progress", artifactName, count, total });

      try {
        req.log.info({ artifactName }, "Generating artifact with AI");
        const aiResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [{ role: "user", content: await buildArtifactPrompt(artifactName, projectContext) }],
        });
        const textBlock = aiResponse.content.find(b => b.type === "text");
        const markdownContent = textBlock && textBlock.type === "text" ? textBlock.text : "";

        const pdfBuffer = await generateArtifactPdf(artifactName, markdownContent, project.title, clientName, generatedAt);
        const safeName = artifactName.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
        const filename = `${safeName}_${generatedAt.toISOString().slice(0, 10)}.pdf`;

        const webUrl = await uploadFileToSharePoint(sharepointSiteId, GENERATED_ARTIFACTS_FOLDER, filename, pdfBuffer, "application/pdf");
        if (!webUrl) {
          const msg = `Failed to upload "${artifactName}" to SharePoint`;
          errors.push(msg);
          sendEvent({ type: "artifactError", artifactName, error: msg });
          continue;
        }

        results.push({ artifactName, sharepointUrl: webUrl, generatedAt: generatedAt.toISOString() });
        req.log.info({ artifactName, webUrl }, "Artifact generated and uploaded");
        sendEvent({ type: "artifactDone", artifactName, sharepointUrl: webUrl });
      } catch (err) {
        log.error({ err, artifactName }, "Error generating artifact");
        const msg = `Error generating "${artifactName}": ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        sendEvent({ type: "artifactError", artifactName, error: msg });
      }
    }

    if (results.length === 0) {
      sendEvent({ type: "error", error: "All artifact generations failed.", details: errors });
      res.end();
      return;
    }

    const merged = [
      ...(project.generatedArtifacts ?? []).filter(e => !results.some(r => r.artifactName === e.artifactName)),
      ...results,
    ];
    await db.update(projectsTable).set({ generatedArtifacts: merged, updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
    sendEvent({ type: "done", artifacts: merged, errors: errors.length > 0 ? errors : undefined });
    res.end();
  },
);

// ── 2. draft-artifacts: AI drafts only (no PDF / no SharePoint) ─────────────
router.post(
  "/admin/projects/:projectId/draft-artifacts",
  requireAdmin,
  async (req, res) => {
    const projectId = parseInt(String(req.params.projectId), 10);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

    const singleArtifactName: string | undefined =
      typeof req.body?.artifactName === "string" && req.body.artifactName.trim()
        ? req.body.artifactName.trim()
        : undefined;

    const loaded = await loadProjectAndClient(projectId);
    if (!loaded.ok) { res.status(loaded.status).json(loaded.body); return; }
    const { project, tasks, clientName } = loaded;

    const incomplete = tasks.filter(t => t.column !== "completed");
    if (incomplete.length > 0 && !singleArtifactName) {
      res.status(400).json({
        error: `${incomplete.length} task${incomplete.length === 1 ? "" : "s"} not yet completed. All tasks must be in the Completed column.`,
      });
      return;
    }

    const allFromTasks = collectArtifactNames(tasks);
    if (allFromTasks.size === 0 && !singleArtifactName) {
      res.status(400).json({
        error: "No artifacts are defined in the project tasks.",
        code: "NO_ARTIFACTS_DEFINED",
      });
      return;
    }

    const allArtifactNames: Set<string> = singleArtifactName
      ? new Set([singleArtifactName])
      : allFromTasks;

    const projectContext = buildProjectContext(project, tasks, clientName);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      const r = res as unknown as { flush?: () => void };
      if (typeof r.flush === "function") r.flush();
    };

    const drafts: Array<{ artifactName: string; markdown: string }> = [];
    const errors: string[] = [];
    const total = allArtifactNames.size;
    let count = 0;

    for (const artifactName of allArtifactNames) {
      count++;
      sendEvent({ type: "progress", artifactName, count, total });

      try {
        req.log.info({ artifactName }, "Drafting artifact with AI");
        const aiResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [{ role: "user", content: await buildArtifactPrompt(artifactName, projectContext) }],
        });
        const textBlock = aiResponse.content.find(b => b.type === "text");
        const markdown = textBlock && textBlock.type === "text" ? textBlock.text : "";

        drafts.push({ artifactName, markdown });
        req.log.info({ artifactName }, "Artifact draft generated");
        sendEvent({ type: "artifactDraft", artifactName, markdown });
      } catch (err) {
        log.error({ err, artifactName }, "Error drafting artifact");
        const msg = `Error drafting "${artifactName}": ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        sendEvent({ type: "artifactError", artifactName, error: msg });
      }
    }

    if (drafts.length === 0) {
      sendEvent({ type: "error", error: "All draft generations failed.", details: errors });
      res.end();
      return;
    }

    sendEvent({ type: "done", drafts, errors: errors.length > 0 ? errors : undefined });
    res.end();
  },
);

// ── 3. finalize-artifact: render PDF + upload for ONE artifact ───────────────
router.post(
  "/admin/projects/:projectId/finalize-artifact",
  requireAdmin,
  async (req, res) => {
    const projectId = parseInt(String(req.params.projectId), 10);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

    const artifactName: string | undefined =
      typeof req.body?.artifactName === "string" && req.body.artifactName.trim()
        ? req.body.artifactName.trim()
        : undefined;
    const markdown: string | undefined =
      typeof req.body?.markdown === "string" ? req.body.markdown : undefined;

    if (!artifactName) { res.status(400).json({ error: "artifactName is required" }); return; }
    if (markdown === undefined) { res.status(400).json({ error: "markdown is required" }); return; }

    const loaded = await loadProjectAndClient(projectId);
    if (!loaded.ok) { res.status(loaded.status).json(loaded.body); return; }
    const { project, clientName, sharepointSiteId } = loaded;

    try {
      await ensureSharePointFolderAtRoot(sharepointSiteId, GENERATED_ARTIFACTS_FOLDER);

      const generatedAt = new Date();
      const pdfBuffer = await generateArtifactPdf(artifactName, markdown, project.title, clientName, generatedAt);
      const safeName = artifactName.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
      const filename = `${safeName}_${generatedAt.toISOString().slice(0, 10)}.pdf`;

      const webUrl = await uploadFileToSharePoint(sharepointSiteId, GENERATED_ARTIFACTS_FOLDER, filename, pdfBuffer, "application/pdf");
      if (!webUrl) {
        res.status(502).json({ error: `Failed to upload "${artifactName}" to SharePoint` });
        return;
      }

      const newEntry = { artifactName, sharepointUrl: webUrl, generatedAt: generatedAt.toISOString() };
      const merged = [
        ...(project.generatedArtifacts ?? []).filter(e => e.artifactName !== artifactName),
        newEntry,
      ];
      await db.update(projectsTable).set({ generatedArtifacts: merged, updatedAt: new Date() }).where(eq(projectsTable.id, projectId));

      req.log.info({ artifactName, webUrl }, "Artifact finalized and uploaded");
      res.json({ sharepointUrl: webUrl, artifacts: merged });
    } catch (err) {
      log.error({ err, artifactName }, "Error finalizing artifact");
      res.status(500).json({ error: `Failed to finalize "${artifactName}": ${err instanceof Error ? err.message : String(err)}` });
    }
  },
);

export default router;
