import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

const NAVY = rgb(10 / 255, 37 / 255, 64 / 255);
const BLUE = rgb(0 / 255, 120 / 255, 212 / 255);
const TEAL = rgb(0 / 255, 180 / 255, 216 / 255);
const LIGHT_GRAY = rgb(247 / 255, 249 / 255, 252 / 255);
const MID_GRAY = rgb(100 / 255, 116 / 255, 139 / 255);
const DARK_TEXT = rgb(15 / 255, 23 / 255, 42 / 255);
const WHITE = rgb(1, 1, 1);

export interface QuizPdfData {
  name: string;
  email: string;
  company?: string;
  totalScore: number;
  tier: string;
  recommendedService: string;
  categoryScores: Record<string, number>;
  whatThisMeans: string;
  whyThisFits: string;
  roiProjection: string;
  reportTitle: string;
  categoryConfig: Array<{ key: string; label: string }>;
}

function wrapText(text: string, maxWidth: number, fontSize: number, charsPerLine: number): string[] {
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

export async function generateQuizPdf(data: QuizPdfData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // ─── Page 1: Summary ──────────────────────────────────────────────────────
  const page1 = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page1.getSize();

  // Header band
  page1.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: NAVY });
  page1.drawText("Shane McCaw Consulting", {
    x: 36, y: height - 32, size: 16, font: helveticaBold, color: WHITE,
  });
  page1.drawText("Lead Microsoft 365 Architect", {
    x: 36, y: height - 52, size: 10, font: helvetica, color: rgb(0.6, 0.7, 0.8),
  });
  page1.drawText("shanemccaw.consulting", {
    x: width - 36 - 160, y: height - 44, size: 10, font: helvetica, color: BLUE,
  });

  // Title — dynamic per quiz type
  const titleFontSize = data.reportTitle.length > 38 ? 18 : 22;
  page1.drawText(data.reportTitle, {
    x: 36, y: height - 120, size: titleFontSize, font: helveticaBold, color: DARK_TEXT,
  });
  page1.drawText(`Prepared for: ${data.name}${data.company ? ` — ${data.company}` : ""}`, {
    x: 36, y: height - 148, size: 11, font: helvetica, color: MID_GRAY,
  });
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  page1.drawText(`Date: ${dateStr}`, {
    x: 36, y: height - 164, size: 11, font: helvetica, color: MID_GRAY,
  });

  // Score box
  const boxY = height - 280;
  page1.drawRectangle({ x: 36, y: boxY, width: 160, height: 100, color: NAVY });
  page1.drawText("Total Score", { x: 56, y: boxY + 75, size: 11, font: helvetica, color: WHITE });
  page1.drawText(`${data.totalScore}`, { x: 76, y: boxY + 36, size: 36, font: helveticaBold, color: BLUE });
  page1.drawText("out of 50", { x: 62, y: boxY + 16, size: 10, font: helvetica, color: rgb(0.6, 0.7, 0.8) });

  // Tier box
  page1.drawRectangle({ x: 212, y: boxY, width: 200, height: 100, color: BLUE });
  page1.drawText("Maturity Tier", { x: 232, y: boxY + 75, size: 11, font: helvetica, color: WHITE });
  const tierFontSize = data.tier.length > 10 ? 16 : 20;
  page1.drawText(data.tier, { x: 232, y: boxY + 40, size: tierFontSize, font: helveticaBold, color: WHITE });
  const tierDesc: Record<string, string> = {
    "Beginner": "0–15 · Just starting out",
    "Developing": "16–25 · Building foundations",
    "Emerging": "26–35 · Gaining momentum",
    "Advanced": "36–45 · Nearly ready",
    "Ready": "46–50 · Launch-ready",
  };
  page1.drawText(tierDesc[data.tier] ?? "", { x: 232, y: boxY + 18, size: 9, font: helvetica, color: rgb(0.85, 0.92, 1) });

  // Section: Category Breakdown — dynamic per quiz type
  const catY = boxY - 40;
  page1.drawText("Assessment Category Breakdown", {
    x: 36, y: catY, size: 14, font: helveticaBold, color: DARK_TEXT,
  });

  let rowY = catY - 24;
  for (const cat of data.categoryConfig) {
    const score = data.categoryScores[cat.key] ?? 0;
    const pct = Math.min(score / 10, 1);
    const barWidth = 260;
    const filledWidth = Math.round(barWidth * pct);

    page1.drawText(cat.label, { x: 36, y: rowY, size: 10, font: helvetica, color: DARK_TEXT });
    page1.drawText(`${score}/10`, { x: width - 60, y: rowY, size: 10, font: helveticaBold, color: BLUE });

    const barY = rowY - 14;
    page1.drawRectangle({ x: 36, y: barY, width: barWidth, height: 8, color: LIGHT_GRAY });
    if (filledWidth > 0) {
      const barColor = score >= 7 ? TEAL : score >= 4 ? BLUE : rgb(0.8, 0.3, 0.3);
      page1.drawRectangle({ x: 36, y: barY, width: filledWidth, height: 8, color: barColor });
    }

    rowY -= 38;
  }

  // Section: What This Means
  const meansY = rowY - 10;
  page1.drawRectangle({ x: 36, y: meansY - 90, width: width - 72, height: 110, color: LIGHT_GRAY });
  page1.drawText("What This Means for Your Organisation", {
    x: 48, y: meansY - 12, size: 12, font: helveticaBold, color: DARK_TEXT,
  });
  const meansLines = wrapText(data.whatThisMeans, width - 96, 10, 90);
  let meansLineY = meansY - 30;
  for (const line of meansLines.slice(0, 4)) {
    page1.drawText(line, { x: 48, y: meansLineY, size: 10, font: helvetica, color: DARK_TEXT });
    meansLineY -= 15;
  }

  // ─── Page 2: Recommendations ─────────────────────────────────────────────
  const page2 = pdfDoc.addPage(PageSizes.A4);

  // Header band
  page2.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: NAVY });
  page2.drawText("Shane McCaw Consulting", {
    x: 36, y: height - 32, size: 16, font: helveticaBold, color: WHITE,
  });
  page2.drawText(`${data.reportTitle} — Recommendations`, {
    x: 36, y: height - 52, size: 10, font: helvetica, color: rgb(0.6, 0.7, 0.8),
  });

  let p2Y = height - 110;

  // Recommended Service
  page2.drawText("Recommended Service", { x: 36, y: p2Y, size: 14, font: helveticaBold, color: DARK_TEXT });
  p2Y -= 24;
  page2.drawRectangle({ x: 36, y: p2Y - 20, width: width - 72, height: 36, color: BLUE });
  page2.drawText(data.recommendedService, { x: 48, y: p2Y - 8, size: 13, font: helveticaBold, color: WHITE });
  p2Y -= 50;

  // Why This Fits
  page2.drawText("Why This Fits Your Situation", { x: 36, y: p2Y, size: 13, font: helveticaBold, color: DARK_TEXT });
  p2Y -= 18;
  const whyLines = wrapText(data.whyThisFits, width - 72, 10, 90);
  for (const line of whyLines.slice(0, 6)) {
    page2.drawText(line, { x: 36, y: p2Y, size: 10, font: helvetica, color: DARK_TEXT });
    p2Y -= 15;
  }
  p2Y -= 16;

  // ROI Projection
  page2.drawText("ROI Projection", { x: 36, y: p2Y, size: 13, font: helveticaBold, color: DARK_TEXT });
  p2Y -= 18;
  page2.drawRectangle({ x: 36, y: p2Y - (wrapText(data.roiProjection, width - 96, 10, 90).slice(0, 5).length * 15) - 16, width: width - 72, height: (wrapText(data.roiProjection, width - 96, 10, 90).slice(0, 5).length * 15) + 28, color: rgb(0.93, 0.97, 1) });
  const roiLines = wrapText(data.roiProjection, width - 96, 10, 90);
  for (const line of roiLines.slice(0, 5)) {
    page2.drawText(line, { x: 48, y: p2Y, size: 10, font: helvetica, color: DARK_TEXT });
    p2Y -= 15;
  }
  p2Y -= 32;

  // Next Steps
  page2.drawText("Your Next Steps", { x: 36, y: p2Y, size: 13, font: helveticaBold, color: DARK_TEXT });
  p2Y -= 20;
  const steps = [
    "Review this report with your leadership team and IT stakeholders.",
    "Identify the top 2–3 categories where you scored below 7 and prioritise those gaps.",
    "Book a complimentary 30-minute strategy call with Shane to map a personalised roadmap.",
    "Visit shanemccaw.consulting/contact to get started today.",
  ];
  for (let i = 0; i < steps.length; i++) {
    page2.drawCircle({ x: 46, y: p2Y + 4, size: 8, color: BLUE });
    page2.drawText(`${i + 1}`, { x: 43, y: p2Y, size: 9, font: helveticaBold, color: WHITE });
    const stepLines = wrapText(steps[i], width - 96, 10, 85);
    for (const line of stepLines) {
      page2.drawText(line, { x: 62, y: p2Y, size: 10, font: helvetica, color: DARK_TEXT });
      p2Y -= 14;
    }
    p2Y -= 8;
  }

  // CTA box — generic across all quiz types
  p2Y -= 10;
  page2.drawRectangle({ x: 36, y: p2Y - 56, width: width - 72, height: 72, color: NAVY });
  page2.drawText("Ready to act on your results?", {
    x: 56, y: p2Y - 14, size: 13, font: helveticaBold, color: WHITE,
  });
  page2.drawText("Book your complimentary strategy call at shanemccaw.consulting/contact", {
    x: 56, y: p2Y - 32, size: 10, font: helvetica, color: rgb(0.7, 0.85, 1),
  });
  page2.drawText("or email: shane@shanemccaw.consulting", {
    x: 56, y: p2Y - 46, size: 10, font: helvetica, color: rgb(0.7, 0.85, 1),
  });

  // Footer on both pages
  for (const page of [page1, page2]) {
    page.drawText("© Shane McCaw Consulting LLC  |  shanemccaw.consulting  |  Confidential", {
      x: 36, y: 18, size: 8, font: helvetica, color: MID_GRAY,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
