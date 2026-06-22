import { Router } from "express";
import { db, projectsTable, kanbanTasksTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { uploadFileToSharePoint, graphCredentialsPresent } from "../lib/graph";
import { logger } from "../lib/logger";

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

router.post(
  "/admin/projects/:projectId/generate-artifacts",
  requireAdmin,
  async (req, res) => {
    const projectId = parseInt(String(req.params.projectId), 10);
    if (isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const tasks = await db
      .select()
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.projectId, projectId));

    if (tasks.length === 0) {
      res.status(400).json({ error: "No tasks found for this project" });
      return;
    }

    const incomplete = tasks.filter(t => t.column !== "completed");
    if (incomplete.length > 0) {
      res.status(400).json({
        error: `${incomplete.length} task${incomplete.length === 1 ? "" : "s"} not yet completed. All tasks must be in the Completed column.`,
      });
      return;
    }

    if (!graphCredentialsPresent()) {
      res.status(503).json({
        error: "Microsoft Graph credentials are not configured. Set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID in Replit Secrets.",
        code: "GRAPH_CREDENTIALS_MISSING",
      });
      return;
    }

    let clientName = "Client";
    let sharepointSiteId: string | null = null;
    if (project.clientUserId) {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, project.clientUserId))
        .limit(1);
      if (user) {
        clientName = user.company ?? user.name ?? user.email ?? "Client";
        sharepointSiteId = user.sharepointSiteId ?? null;
      }
    }

    if (!sharepointSiteId) {
      res.status(503).json({
        error: "The client does not have a SharePoint site ID configured. Edit the client profile in the CRM to add it.",
        code: "SHAREPOINT_SITE_ID_MISSING",
      });
      return;
    }

    const allArtifactNames = new Set<string>();
    for (const task of tasks) {
      const meta = task.taskMetadata as Record<string, unknown> | null;
      if (meta && Array.isArray(meta.artifactsProduced)) {
        for (const name of meta.artifactsProduced as string[]) {
          if (typeof name === "string" && name.trim()) {
            allArtifactNames.add(name.trim());
          }
        }
      }
    }

    if (allArtifactNames.size === 0) {
      res.status(400).json({
        error: "No artifacts are defined in the project tasks. Add artifact names to task metadata before generating.",
        code: "NO_ARTIFACTS_DEFINED",
      });
      return;
    }

    const projectContext = [
      `Project: ${project.title}`,
      project.description ? `Description: ${project.description}` : null,
      `Client: ${clientName}`,
      `Phase: ${project.phase ?? "N/A"}`,
      "",
      "Completed Tasks:",
      ...tasks.map(t => {
        const meta = t.taskMetadata as Record<string, unknown> | null;
        const parts = [`- [${t.taskType ?? "task"}] ${t.title}`];
        if (t.description) parts.push(`  Description: ${t.description}`);
        if (t.completionNotes) parts.push(`  Completion Notes: ${t.completionNotes}`);
        if (meta) {
          if (typeof meta.postureSummary === "string") parts.push(`  Posture: ${meta.postureSummary}`);
          if (typeof meta.findingsSummary === "string") parts.push(`  Findings: ${meta.findingsSummary}`);
          if (typeof meta.outputSummary === "string") parts.push(`  Output: ${meta.outputSummary}`);
        }
        return parts.join("\n");
      }),
    ].filter(Boolean).join("\n");

    const generatedAt = new Date();
    const results: Array<{ artifactName: string; sharepointUrl: string; generatedAt: string }> = [];
    const errors: string[] = [];

    for (const artifactName of allArtifactNames) {
      try {
        req.log.info({ artifactName }, "Generating artifact with AI");
        const aiResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [
            {
              role: "user",
              content: `You are a senior Microsoft 365 consultant. Generate a professional project artifact document in Markdown format.

Project Context:
${projectContext}

Generate the artifact: "${artifactName}"

Requirements:
- Use proper Markdown headings (##, ###) to structure the document
- Be professional, detailed, and specific to the project context
- Include all relevant sections for this type of document
- Use bullet points for lists
- Length: 400-800 words
- Do NOT include a top-level title (# heading) — that will be added automatically
- Start directly with the first section heading (## ...)`,
            },
          ],
        });

        const textBlock = aiResponse.content.find(b => b.type === "text");
        const markdownContent = textBlock && textBlock.type === "text" ? textBlock.text : "";

        const pdfBuffer = await generateArtifactPdf(
          artifactName,
          markdownContent,
          project.title,
          clientName,
          generatedAt,
        );

        const safeName = artifactName.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
        const filename = `${safeName}_${generatedAt.toISOString().slice(0, 10)}.pdf`;

        const webUrl = await uploadFileToSharePoint(
          sharepointSiteId,
          "Generated Artifacts",
          filename,
          pdfBuffer,
          "application/pdf",
        );

        if (!webUrl) {
          errors.push(`Failed to upload "${artifactName}" to SharePoint`);
          continue;
        }

        results.push({ artifactName, sharepointUrl: webUrl, generatedAt: generatedAt.toISOString() });
        req.log.info({ artifactName, webUrl }, "Artifact generated and uploaded");
      } catch (err) {
        logger.error({ err, artifactName }, "Error generating artifact");
        errors.push(`Error generating "${artifactName}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (results.length === 0) {
      res.status(502).json({ error: "All artifact generations failed.", details: errors });
      return;
    }

    const merged = [
      ...(project.generatedArtifacts ?? []).filter(
        existing => !results.some(r => r.artifactName === existing.artifactName),
      ),
      ...results,
    ];

    await db
      .update(projectsTable)
      .set({ generatedArtifacts: merged, updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));

    res.json({ artifacts: merged, errors: errors.length > 0 ? errors : undefined });
  },
);

export default router;
