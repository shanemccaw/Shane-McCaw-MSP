import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import {
  db,
  servicesTable,
  workflowTemplatesTable,
  workflowTemplateStepsTable,
  workflowTemplateStepTasksTable,
} from "@workspace/db";
import { eq, asc, ilike, or } from "drizzle-orm";
import { logger } from "./logger";

const navy  = rgb(0.039, 0.145, 0.251);
const blue  = rgb(0,     0.471, 0.831);
const teal  = rgb(0,     0.706, 0.847);
const white = rgb(1, 1, 1);
const grey  = rgb(0.42, 0.49, 0.56);

function sanitize(text: string): string {
  return text
    .replace(/\u2011/g, "-")          // non-breaking hyphen → hyphen-minus
    .replace(/\u2013/g, "-")          // en dash → hyphen-minus
    .replace(/\u2014/g, "--")         // em dash → double hyphen
    .replace(/[\u2018\u2019]/g, "'")  // curly single quotes → straight
    .replace(/[\u201C\u201D]/g, '"')  // curly double quotes → straight
    .replace(/\u2026/g, "...")        // ellipsis → three dots
    .replace(/\u00A0/g, " ")          // non-breaking space → regular space
    .replace(/\u2022/g, "-")          // bullet point → ASCII hyphen (WinAnsi safe)
    .replace(/[^\x00-\xFF]/g, "?");   // strip remaining non-Latin-1 chars
}

function wrap(text: string, maxW: number, font: PDFFont, size: number): string[] {
  const words = sanitize(text).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function dt(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
) {
  page.drawText(sanitize(text), { x, y, font, size, color });
}

export async function generateServiceOverviewPdf(serviceName: string): Promise<Buffer | null> {
  const pageW  = 595;
  const pageH  = 842;
  const margin = 50;
  const bodyW  = pageW - margin * 2;

  const service = await (async () => {
    const exact = await db
      .select()
      .from(servicesTable)
      .where(ilike(servicesTable.name, serviceName))
      .limit(1);
    if (exact[0]) return exact[0];
    const fuzzy = await db
      .select()
      .from(servicesTable)
      .where(or(
        ilike(servicesTable.name, `%${serviceName}%`),
        ilike(servicesTable.name, `%${serviceName.split(" ")[0]}%`),
      ))
      .limit(1);
    return fuzzy[0] ?? null;
  })();

  if (!service) {
    logger.warn({ serviceName }, "generateServiceOverviewPdf: service not found");
    return null;
  }

  const templateId = service.workflowTemplateId;
  const steps = templateId
    ? await db
        .select()
        .from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.workflowTemplateId, templateId))
        .orderBy(asc(workflowTemplateStepsTable.order))
    : [];

  const stepTaskMap: Record<number, typeof workflowTemplateStepTasksTable.$inferSelect[]> = {};
  if (steps.length > 0) {
    const allTasks = await db
      .select()
      .from(workflowTemplateStepTasksTable)
      .where(
        steps.length === 1
          ? eq(workflowTemplateStepTasksTable.workflowTemplateStepId, steps[0].id)
          : undefined,
      )
      .orderBy(asc(workflowTemplateStepTasksTable.order));

    const allTasksFull = steps.length > 1
      ? await Promise.all(
          steps.map(s =>
            db
              .select()
              .from(workflowTemplateStepTasksTable)
              .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, s.id))
              .orderBy(asc(workflowTemplateStepTasksTable.order)),
          ),
        )
      : [allTasks];

    steps.forEach((s, i) => {
      stepTaskMap[s.id] = allTasksFull[i] ?? [];
    });
  }

  const pdfDoc = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdfDoc.addPage([pageW, pageH]);

    page.drawRectangle({ x: 0, y: pageH - 56, width: pageW, height: 56, color: navy });
    dt(page, "Shane McCaw Consulting", margin, pageH - 22, bold, 13, white);
    dt(page, "Lead Microsoft 365 Architect", margin, pageH - 38, regular, 8, rgb(0.7, 0.8, 0.9));

    page.drawRectangle({ x: 0, y: 0, width: pageW, height: 24, color: navy });
    dt(page, "shanemccaw.com  ·  info@shanemccaw.com", margin, 8, regular, 7, rgb(0.6, 0.7, 0.8));
    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    dt(page, dateStr, pageW - margin - bold.widthOfTextAtSize(dateStr, 7), 8, regular, 7, rgb(0.5, 0.6, 0.7));

    y = pageH - 74;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 30) newPage();
  };

  const sectionHeading = (title: string) => {
    ensureSpace(28);
    y -= 6;
    dt(page, title.toUpperCase(), margin, y, bold, 8, blue);
    y -= 5;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.8, color: teal });
    y -= 14;
  };

  const bullet = (text: string, indent = 0) => {
    const lines = wrap(text, bodyW - 14 - indent, regular, 9);
    for (let i = 0; i < lines.length; i++) {
      ensureSpace(13);
      if (i === 0) dt(page, "•", margin + indent, y, bold, 9, blue);
      dt(page, lines[i], margin + 12 + indent, y, regular, 9, navy);
      y -= 12;
    }
  };

  const para = (text: string) => {
    const stripped = text.replace(/\*\*(.*?)\*\*/g, "$1");
    const lines = wrap(stripped, bodyW, regular, 9);
    for (const l of lines) {
      ensureSpace(13);
      dt(page, l, margin, y, regular, 9, navy);
      y -= 13;
    }
    y -= 3;
  };

  newPage();

  dt(page, service.name, margin, y, bold, 22, navy);
  y -= 28;

  if (service.tagline) {
    dt(page, service.tagline, margin, y, regular, 11, blue);
    y -= 20;
  }

  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 2, color: blue });
  y -= 20;

  if (service.targetAudience) {
    dt(page, "FOR", margin, y, bold, 7, teal);
    y -= 12;
    para(service.targetAudience);
  }

  if (service.description) {
    sectionHeading("Overview");
    para(service.description);
  }

  const deliverables = service.deliverables ?? [];
  const inclusions   = service.inclusions   ?? [];
  const combined = [...new Set([...deliverables, ...inclusions])];
  if (combined.length > 0) {
    sectionHeading("What's Included");
    for (const d of combined) bullet(d);
  }

  if (steps.length > 0) {
    sectionHeading("Engagement Phases");
    for (const step of steps) {
      ensureSpace(20);
      dt(page, step.title, margin, y, bold, 10, navy);
      y -= 13;
      if (step.description) {
        para(step.description);
      }
      const tasks = stepTaskMap[step.id] ?? [];
      const deliverableTasks = tasks.flatMap(t => t.clientDeliverables ?? []);
      if (deliverableTasks.length > 0) {
        for (const d of deliverableTasks) bullet(d, 8);
      } else if (tasks.length > 0) {
        for (const t of tasks) bullet(t.title, 8);
      }
      y -= 6;
    }
  }

  const features = service.features ?? [];
  if (features.length > 0) {
    sectionHeading("Key Features");
    for (const f of features) bullet(f);
  }

  sectionHeading("Investment");
  const price = service.price ?? service.basePrice;
  if (price) {
    const max = service.maxPrice;
    const priceStr = max && max !== price
      ? `$${Number(price).toLocaleString()} – $${Number(max).toLocaleString()} USD`
      : `$${Number(price).toLocaleString()} USD`;
    ensureSpace(16);
    dt(page, priceStr, margin, y, bold, 13, navy);
    y -= 18;
  }
  if (service.turnaround) {
    ensureSpace(14);
    dt(page, `Typical engagement: ${service.turnaround}`, margin, y, regular, 9, grey);
    y -= 14;
  }

  ensureSpace(40);
  y -= 10;
  page.drawRectangle({ x: margin, y: y - 32, width: bodyW, height: 40, color: rgb(0.96, 0.98, 1) });
  page.drawRectangle({ x: margin, y: y + 8 - 32, width: 3, height: 32, color: blue });
  dt(page, "Ready to get started?", margin + 12, y - 4, bold, 10, navy);
  dt(page, "Book a free 30-minute discovery call at shanemccaw.com/book", margin + 12, y - 18, regular, 8, grey);
  y -= 44;

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
