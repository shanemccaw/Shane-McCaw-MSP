import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

const NAVY = rgb(10 / 255, 37 / 255, 64 / 255);
const BLUE = rgb(0 / 255, 120 / 255, 212 / 255);
const TEAL = rgb(0 / 255, 180 / 255, 216 / 255);
const LIGHT_GRAY = rgb(247 / 255, 249 / 255, 252 / 255);
const MID_GRAY = rgb(100 / 255, 116 / 255, 139 / 255);
const DARK_TEXT = rgb(15 / 255, 23 / 255, 42 / 255);
const WHITE = rgb(1, 1, 1);

/**
 * Checklist copy is verbatim from shane-mccaw-consulting/src/pages/home/quizData.ts's
 * `VARIANTS[i].none` — the already-published "why this pillar matters" copy Home.tsx
 * itself shows for an unanswered pillar question. Reused rather than invented (#457's
 * "flag as a content gap rather than fabricate" instruction): this is real,
 * Shane-authored copy already live on the site, reorganized into checklist form. Kept
 * in sync by hand — api-server and shane-mccaw-consulting are separate apps with no
 * shared frontend/backend module.
 */
const CHECKLIST_ITEMS: Array<{ pillar: string; title: string; body: string }> = [
  {
    pillar: "Governance",
    title: "Copilot inherits every permission mistake you have ever made.",
    body: "It reads everything the signed-in user could technically reach, then summarises it in a sentence. Ownership gaps that were harmless while nobody was looking become an answer in a chat window.",
  },
  {
    pillar: "Security",
    title: "The gap is almost never the policy. It is the exclusion.",
    body: "Break-glass accounts, a service principal added during a migration, one group excluded for a project that ended two years ago — each reasonable on the day, together the route in, and no quarterly review is scoped to find them.",
  },
  {
    pillar: "Compliance",
    title: "Labels that exist and labels that are applied are different numbers.",
    body: "Most tenants have a sensitivity taxonomy. Far fewer have it enforced on the content that matters. Copilot does not distinguish between a defined label and an applied one.",
  },
  {
    pillar: "Licensing",
    title: "Seats get bought by headcount and used by habit.",
    body: "The allocation that made sense at purchase rarely matches where the work actually is three months later. Nobody reclaims a licence, because nobody is measuring one.",
  },
  {
    pillar: "Adoption",
    title: "Usage concentrates in Teams, Outlook and Word — and stops.",
    body: "Grounding a prompt in your own content is not discoverable — it has to be shown once, by someone, against real content. Without that, usage plateaus in three apps.",
  },
  {
    pillar: "Health",
    title: "A tenant does not stay where you left it.",
    body: "Admins change settings, vendors consent to OAuth apps, guests get added, defaults shift underneath you when Microsoft ships. An assessment tells you what is wrong today. Drift is what happens on every day after that.",
  },
];

export interface CopilotChecklistPdfData {
  name: string;
  company?: string | null;
  /** 0-100 estimated readiness score. */
  score: number;
  /** e.g. "Advanced" / "Established" / "Developing" / "Early". */
  band: string;
  /** Six pillars, each 0-100. */
  pillars: Array<{ name: string; value: number }>;
}

function wrapText(text: string, charsPerLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (test.length > charsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateCopilotChecklistPdf(data: CopilotChecklistPdfData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // ─── Page 1: Your estimated results ──────────────────────────────────────
  const page1 = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page1.getSize();

  page1.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: NAVY });
  page1.drawText("Shane McCaw Consulting", { x: 36, y: height - 32, size: 16, font: helveticaBold, color: WHITE });
  page1.drawText("Lead Microsoft 365 Architect", { x: 36, y: height - 52, size: 10, font: helvetica, color: rgb(0.6, 0.7, 0.8) });
  page1.drawText("shanemccaw.com", { x: width - 36 - 160, y: height - 44, size: 10, font: helvetica, color: BLUE });

  page1.drawText("Your Copilot Readiness Estimate", { x: 36, y: height - 120, size: 20, font: helveticaBold, color: DARK_TEXT });
  page1.drawText(`Prepared for: ${data.name}${data.company ? ` — ${data.company}` : ""}`, { x: 36, y: height - 148, size: 11, font: helvetica, color: MID_GRAY });
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  page1.drawText(`Date: ${dateStr}`, { x: 36, y: height - 164, size: 11, font: helvetica, color: MID_GRAY });

  const boxY = height - 280;
  page1.drawRectangle({ x: 36, y: boxY, width: 160, height: 100, color: NAVY });
  page1.drawText("Estimated Score", { x: 56, y: boxY + 75, size: 11, font: helvetica, color: WHITE });
  page1.drawText(`${data.score}`, { x: 76, y: boxY + 36, size: 36, font: helveticaBold, color: BLUE });
  page1.drawText("out of 100", { x: 58, y: boxY + 16, size: 10, font: helvetica, color: rgb(0.6, 0.7, 0.8) });

  page1.drawRectangle({ x: 212, y: boxY, width: 200, height: 100, color: BLUE });
  page1.drawText("Band", { x: 232, y: boxY + 75, size: 11, font: helvetica, color: WHITE });
  page1.drawText(data.band, { x: 232, y: boxY + 40, size: 20, font: helveticaBold, color: WHITE });
  page1.drawText("Self-reported estimate, not a tenant scan", { x: 232, y: boxY + 18, size: 8.5, font: helvetica, color: rgb(0.85, 0.92, 1) });

  const catY = boxY - 40;
  page1.drawText("Your Six Pillars", { x: 36, y: catY, size: 14, font: helveticaBold, color: DARK_TEXT });

  let rowY = catY - 24;
  for (const pillar of data.pillars) {
    const value = Math.max(0, Math.min(100, pillar.value));
    const barWidth = 260;
    const filledWidth = Math.round(barWidth * (value / 100));

    page1.drawText(pillar.name, { x: 36, y: rowY, size: 10, font: helvetica, color: DARK_TEXT });
    page1.drawText(`${value}/100`, { x: width - 70, y: rowY, size: 10, font: helveticaBold, color: BLUE });

    const barY = rowY - 14;
    page1.drawRectangle({ x: 36, y: barY, width: barWidth, height: 8, color: LIGHT_GRAY });
    if (filledWidth > 0) {
      const barColor = value >= 70 ? TEAL : value >= 40 ? BLUE : rgb(0.8, 0.3, 0.3);
      page1.drawRectangle({ x: 36, y: barY, width: filledWidth, height: 8, color: barColor });
    }
    rowY -= 34;
  }

  page1.drawText("© Shane McCaw Consulting LLC  |  shanemccaw.com  |  Confidential", { x: 36, y: 18, size: 8, font: helvetica, color: MID_GRAY });

  // ─── Page 2: Six things worth checking ───────────────────────────────────
  const page2 = pdfDoc.addPage(PageSizes.A4);
  page2.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: NAVY });
  page2.drawText("Shane McCaw Consulting", { x: 36, y: height - 32, size: 16, font: helveticaBold, color: WHITE });
  page2.drawText("Copilot Readiness Checklist", { x: 36, y: height - 52, size: 10, font: helvetica, color: rgb(0.6, 0.7, 0.8) });

  let p2Y = height - 118;
  page2.drawText("Six things worth checking before you deploy Copilot", { x: 36, y: p2Y, size: 16, font: helveticaBold, color: DARK_TEXT });
  p2Y -= 34;

  for (let i = 0; i < CHECKLIST_ITEMS.length; i++) {
    const item = CHECKLIST_ITEMS[i];
    page2.drawCircle({ x: 46, y: p2Y + 4, size: 9, color: BLUE });
    page2.drawText(`${i + 1}`, { x: 42.5, y: p2Y, size: 9, font: helveticaBold, color: WHITE });

    page2.drawText(item.pillar.toUpperCase(), { x: 62, y: p2Y + 4, size: 8.5, font: helveticaBold, color: BLUE });
    p2Y -= 13;
    const titleLines = wrapText(item.title, 78);
    for (const line of titleLines) {
      page2.drawText(line, { x: 62, y: p2Y, size: 11.5, font: helveticaBold, color: DARK_TEXT });
      p2Y -= 15;
    }
    const bodyLines = wrapText(item.body, 92);
    for (const line of bodyLines.slice(0, 3)) {
      page2.drawText(line, { x: 62, y: p2Y, size: 9.5, font: helvetica, color: MID_GRAY });
      p2Y -= 13;
    }
    p2Y -= 12;
  }

  p2Y -= 6;
  page2.drawRectangle({ x: 36, y: p2Y - 56, width: width - 72, height: 72, color: NAVY });
  page2.drawText("Want the real number instead of an estimate?", { x: 56, y: p2Y - 14, size: 13, font: helveticaBold, color: WHITE });
  page2.drawText("The Copilot Readiness Assessment scans your actual tenant across all six pillars.", { x: 56, y: p2Y - 32, size: 10, font: helvetica, color: rgb(0.7, 0.85, 1) });
  page2.drawText("shanemccaw.com — or reply to the email this PDF was attached to.", { x: 56, y: p2Y - 46, size: 10, font: helvetica, color: rgb(0.7, 0.85, 1) });

  page2.drawText("© Shane McCaw Consulting LLC  |  shanemccaw.com  |  Confidential", { x: 36, y: 18, size: 8, font: helvetica, color: MID_GRAY });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
