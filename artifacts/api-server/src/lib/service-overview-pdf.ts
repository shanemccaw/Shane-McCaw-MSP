import { PDFDocument, PDFString, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
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
    .replace(/\u2011/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\u2022/g, "-")
    .replace(/[^\x00-\xFF]/g, "?");
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

const DELIVERABLE_CATEGORIES: Array<{ name: string; keywords: string[] }> = [
  { name: "Assessment & Discovery",       keywords: ["assess", "audit", "review", "discover", "analysis", "analys", "diagnos", "evaluat", "survey", "gap", "inventory", "benchmark", "baselining", "baseline"] },
  { name: "Strategy & Roadmap",           keywords: ["strateg", "roadmap", "plan", "design", "architect", "recommend", "blueprint", "framework", "vision", "approach", "proposal"] },
  { name: "Configuration & Implementation", keywords: ["configur", "implement", "deploy", "setup", "set up", "instal", "enabl", "build", "creat", "provision", "migrat", "integrat", "connect", "activat"] },
  { name: "Governance & Security",        keywords: ["governance", "govern", "secur", "complian", "policy", "policies", "control", "protect", "access", "permission", "dlp", "label", "retention", "conditional", "mfa", "identity", "zero trust", "audit log"] },
  { name: "Training & Enablement",        keywords: ["train", "workshop", "session", "enablement", "onboard", "adoption", "coaching", "demonstration", "demo", "walkthrough", "guidance", "user education"] },
  { name: "Documentation & Reporting",    keywords: ["document", "report", "guide", "template", "handbook", "playbook", "record", "runbook", "knowledge", "deliverable", "artefact", "artifact", "summary", "register"] },
];

function groupDeliverables(items: string[]): Array<{ category: string; items: string[] }> {
  const buckets = new Map<string, string[]>();
  const unassigned: string[] = [];

  for (const item of items) {
    const lower = item.toLowerCase();
    let placed = false;
    for (const cat of DELIVERABLE_CATEGORIES) {
      if (cat.keywords.some(k => lower.includes(k))) {
        const arr = buckets.get(cat.name) ?? [];
        arr.push(item);
        buckets.set(cat.name, arr);
        placed = true;
        break;
      }
    }
    if (!placed) unassigned.push(item);
  }

  if (unassigned.length > 0) {
    buckets.set("Additional Deliverables", unassigned);
  }

  return Array.from(buckets.entries())
    .map(([category, list]) => ({ category, items: list }))
    .filter(g => g.items.length > 0);
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

  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdfDoc.addPage([pageW, pageH]);

    page.drawRectangle({ x: 0, y: pageH - 56, width: pageW, height: 56, color: navy });
    dt(page, "Shane McCaw Consulting", margin, pageH - 22, bold, 13, white);
    dt(page, "Lead Microsoft 365 Architect", margin, pageH - 38, regular, 8, rgb(0.7, 0.8, 0.9));

    page.drawRectangle({ x: 0, y: 0, width: pageW, height: 24, color: navy });
    dt(page, "shanemccaw.com  \u00B7  info@shanemccaw.com", margin, 8, regular, 7, rgb(0.6, 0.7, 0.8));
    dt(page, dateStr, pageW - margin - bold.widthOfTextAtSize(dateStr, 7), 8, regular, 7, rgb(0.5, 0.6, 0.7));

    // Clickable footer links — addLink closes over `page` which is already set above
    const footerWebsite = "shanemccaw.com";
    const footerSep     = "  \u00B7  ";
    const footerEmail   = "info@shanemccaw.com";
    const footerWebsiteW = regular.widthOfTextAtSize(footerWebsite, 7);
    const footerSepW     = regular.widthOfTextAtSize(footerSep, 7);
    addLink("https://shanemccaw.com",       margin,                               8, footerWebsiteW,                                    7);
    addLink("mailto:info@shanemccaw.com",   margin + footerWebsiteW + footerSepW, 8, regular.widthOfTextAtSize(footerEmail, 7),     7);

    y = pageH - 74;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 34) newPage();
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

  // Adds a clickable URI annotation over a text run already drawn on the current page.
  // x/yBaseline match the coordinates passed to dt(); fontSize is the text size in pt.
  const addLink = (url: string, x: number, yBaseline: number, textWidth: number, fontSize: number) => {
    const annot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, yBaseline - 2, x + textWidth, yBaseline + fontSize + 1],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    });
    page.node.addAnnot(pdfDoc.context.register(annot));
  };

  // ── 1. Title Page ───────────────────────────────────────────────────────────
  newPage();

  // Service name — large, centred vertically in the upper half
  const titleLines = wrap(service.name, bodyW, bold, 28);
  let ty = 530;
  for (const line of titleLines) {
    dt(page, line, margin, ty, bold, 28, navy);
    ty -= 36;
  }
  ty -= 6;

  if (service.tagline) {
    const tagLines = wrap(service.tagline, bodyW, regular, 12);
    for (const line of tagLines) {
      dt(page, line, margin, ty, regular, 12, blue);
      ty -= 17;
    }
    ty -= 6;
  }

  // Horizontal rule
  page.drawLine({ start: { x: margin, y: ty }, end: { x: pageW - margin, y: ty }, thickness: 2, color: blue });
  ty -= 22;

  // Byline
  dt(page, "Shane McCaw Consulting", margin, ty, bold, 13, navy);
  ty -= 17;
  dt(page, "Lead Microsoft 365 Architect", margin, ty, regular, 10, grey);
  ty -= 14;

  // Service page URL — clickable link back to the live service page
  if (service.pageHref) {
    const serviceUrl = `shanemccaw.com${service.pageHref}`;
    const serviceUrlFull = `https://shanemccaw.com${service.pageHref}`;
    dt(page, serviceUrl, margin, ty, regular, 8, teal);
    addLink(serviceUrlFull, margin, ty, regular.widthOfTextAtSize(sanitize(serviceUrl), 8), 8);
    ty -= 13;
  }

  // Date near the bottom of the title page
  dt(page, dateStr, margin, 80, regular, 9, grey);

  // ── 2. Content pages start here ────────────────────────────────────────────
  newPage();

  // Overview
  if (service.description) {
    sectionHeading("Overview");
    para(service.description);
  }

  // What's Included — grouped into logical categories
  const deliverables = service.deliverables ?? [];
  const inclusions   = service.inclusions   ?? [];
  const combined = [...new Set([...deliverables, ...inclusions])];
  if (combined.length > 0) {
    sectionHeading("What's Included");
    const groups = groupDeliverables(combined);
    if (groups.length <= 1) {
      // Too few items to sub-group — render flat
      for (const d of combined) bullet(d);
    } else {
      for (const group of groups) {
        ensureSpace(20);
        dt(page, group.category, margin, y, bold, 9, navy);
        y -= 13;
        for (const item of group.items) bullet(item, 8);
        y -= 4;
      }
    }
  }

  // Engagement Phases
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

  // Key Features
  const features = service.features ?? [];
  if (features.length > 0) {
    sectionHeading("Key Features");
    for (const f of features) bullet(f);
  }

  // Investment
  sectionHeading("Investment");
  const price = service.price ?? service.basePrice;
  if (price) {
    const max = service.maxPrice;
    const priceStr = max && max !== price
      ? `$${Number(price).toLocaleString()} – $${Number(max).toLocaleString()} USD`
      : `$${Number(price).toLocaleString()} USD`;
    ensureSpace(16);
    dt(page, priceStr, margin, y, bold, 13, navy);
    y -= 20;
  }
  if (service.turnaround) {
    ensureSpace(14);
    dt(page, `Typical engagement: ${service.turnaround}`, margin, y, regular, 9, grey);
    y -= 14;
  }
  ensureSpace(26);
  dt(page, "Price may vary based on complexity, scope, and organizational size.", margin, y, regular, 8, grey);
  y -= 13;
  dt(page, "Expedited delivery available upon request.", margin, y, regular, 8, grey);
  y -= 14;

  // Why This Service Matters
  if (service.targetAudience) {
    sectionHeading("Why This Service Matters");
    para(service.targetAudience);
  }

  // About the Consultant
  sectionHeading("About the Consultant");
  para("Shane McCaw — Lead Microsoft 365 Architect with 30 years of experience designing, securing, and governing enterprise Microsoft 365 environments.");

  // Call to Action
  sectionHeading("Call to Action");

  // Block 1 — Book a discovery call
  ensureSpace(50);
  y -= 10;
  page.drawRectangle({ x: margin, y: y - 32, width: bodyW, height: 40, color: rgb(0.96, 0.98, 1) });
  page.drawRectangle({ x: margin, y: y + 8 - 32, width: 3, height: 32, color: blue });
  dt(page, "Ready to get started?", margin + 12, y - 4, bold, 10, navy);
  const ctaLine1 = "Book a free 30-minute discovery call at shanemccaw.com/book";
  const ctaLineX1 = margin + 12;
  const ctaLineY1 = y - 18;
  dt(page, ctaLine1, ctaLineX1, ctaLineY1, regular, 8, grey);
  addLink("https://shanemccaw.com/book", ctaLineX1, ctaLineY1, regular.widthOfTextAtSize(sanitize(ctaLine1), 8), 8);
  y -= 50;

  // Block 2 — Purchase this service
  ensureSpace(50);
  y -= 4;
  page.drawRectangle({ x: margin, y: y - 32, width: bodyW, height: 40, color: rgb(0.94, 0.97, 1) });
  page.drawRectangle({ x: margin, y: y + 8 - 32, width: 3, height: 32, color: navy });
  dt(page, "Purchase This Service", margin + 12, y - 4, bold, 10, navy);
  const purchaseUrl = `https://shanemccaw.com/crm/portal/onboarding/select?serviceIds=${service.id}`;
  const purchaseUrlX = margin + 12;
  const purchaseUrlY = y - 18;
  dt(page, purchaseUrl, purchaseUrlX, purchaseUrlY, regular, 8, blue);
  addLink(purchaseUrl, purchaseUrlX, purchaseUrlY, regular.widthOfTextAtSize(sanitize(purchaseUrl), 8), 8);
  y -= 46;

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
