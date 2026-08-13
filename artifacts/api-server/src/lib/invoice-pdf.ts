import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface InvoicePdfData {
  invoiceNumber: string;
  createdAt: Date;
  dueDate: Date | null;
  paidAt: Date | null;
  status: string;
  description: string | null;
  amount: string;
  currency: string;
  clientName: string | null;
  clientEmail: string;
  clientCompany: string | null;
  projectTitle: string | null;
  couponCode?: string | null;
  discountAmount?: string | null;
}

const navy  = rgb(0.039, 0.145, 0.251);
const blue  = rgb(0,     0.471, 0.831);
const white = rgb(1, 1, 1);
const grey  = rgb(0.45,  0.45,  0.45);
const green = rgb(0.086, 0.627, 0.220);

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  due: "Due",
  paid: "Paid",
  overdue: "Overdue",
};

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatAmount(amount: string, currency: string): string {
  const num = parseFloat(amount);
  return isNaN(num) ? `${currency.toUpperCase()} ${amount}` : `$${num.toFixed(2)} ${currency.toUpperCase()}`;
}

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageW = 595;
  const pageH = 842;
  const margin = 55;
  const page = pdfDoc.addPage([pageW, pageH]);

  const drawText = (
    str: string,
    x: number,
    y: number,
    opts: { font?: typeof bold; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    page.drawText(str, {
      x, y,
      font: opts.font ?? regular,
      size: opts.size ?? 10,
      color: opts.color ?? navy,
    });
  };

  // ── Header bar ──────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: pageH - 52, width: pageW, height: 52, color: navy });
  drawText("Shane McCaw Consulting", margin, pageH - 22, { font: bold, size: 14, color: white });
  drawText("Lead Microsoft 365 Architect", margin, pageH - 38, { size: 9, color: rgb(0.7, 0.8, 0.9) });

  // Invoice title + number badge
  page.drawRectangle({ x: pageW - 200, y: pageH - 50, width: 190, height: 44, color: blue });
  drawText("INVOICE", pageW - 190, pageH - 20, { font: bold, size: 13, color: white });
  drawText(data.invoiceNumber, pageW - 190, pageH - 36, { size: 9, color: rgb(0.8, 0.9, 1) });

  // ── Bill To block ───────────────────────────────────────────────────────────
  let y = pageH - 90;
  drawText("Bill To", margin, y, { font: bold, size: 9, color: grey });
  y -= 14;
  const recipientName = data.clientCompany ?? data.clientName ?? data.clientEmail;
  drawText(recipientName, margin, y, { font: bold, size: 11 });
  if (data.clientCompany && data.clientName) {
    y -= 13;
    drawText(data.clientName, margin, y, { size: 10 });
  }
  y -= 13;
  drawText(data.clientEmail, margin, y, { size: 9, color: grey });

  // ── Invoice metadata (right side) ───────────────────────────────────────────
  const metaX = pageW - 200;
  let metaY = pageH - 90;
  const metaLine = (label: string, value: string) => {
    drawText(label, metaX, metaY, { size: 9, color: grey });
    drawText(value, metaX + 70, metaY, { size: 9, font: bold });
    metaY -= 14;
  };
  metaLine("Issue Date:", formatDate(data.createdAt));
  if (data.dueDate) metaLine("Due Date:", formatDate(data.dueDate));
  if (data.paidAt) metaLine("Paid On:", formatDate(data.paidAt));
  const statusLabel = STATUS_LABELS[data.status] ?? data.status;
  const statusColor = data.status === "paid" ? green : data.status === "overdue" ? rgb(0.75, 0.1, 0.15) : navy;
  drawText("Status:", metaX, metaY, { size: 9, color: grey });
  drawText(statusLabel, metaX + 70, metaY, { size: 9, font: bold, color: statusColor });

  // ── Divider ──────────────────────────────────────────────────────────────────
  y -= 20;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: blue });
  y -= 20;

  // ── Project reference ────────────────────────────────────────────────────────
  if (data.projectTitle) {
    drawText("Project", margin, y, { size: 9, color: grey });
    drawText(data.projectTitle, margin + 55, y, { size: 9 });
    y -= 20;
  }

  // ── Description table ────────────────────────────────────────────────────────
  page.drawRectangle({ x: margin, y: y - 4, width: pageW - margin * 2, height: 20, color: navy });
  drawText("Description", margin + 8, y + 2, { font: bold, size: 9, color: white });
  drawText("Amount", pageW - margin - 60, y + 2, { font: bold, size: 9, color: white });
  y -= 24;

  const desc = data.description ?? "Professional consulting services";
  drawText(desc, margin + 8, y, { size: 9 });

  // If there's a coupon, show the pre-discount subtotal then the discount row
  const discountNum = data.discountAmount ? parseFloat(data.discountAmount) : 0;
  if (data.couponCode && discountNum > 0) {
    const originalNum = parseFloat(data.amount) + discountNum;
    drawText(formatAmount(originalNum.toFixed(2), data.currency), pageW - margin - 60, y, { size: 9, font: bold });
    y -= 20;

    // Promo code row
    drawText(`Promo Code: ${data.couponCode}`, margin + 8, y, { size: 9, color: green });
    drawText(`-${formatAmount(discountNum.toFixed(2), data.currency)}`, pageW - margin - 60, y, { size: 9, font: bold, color: green });
    y -= 20;
  } else {
    drawText(formatAmount(data.amount, data.currency), pageW - margin - 60, y, { size: 9, font: bold });
    y -= 24;
  }

  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 16;

  // ── Total row ────────────────────────────────────────────────────────────────
  drawText("Total", pageW - margin - 100, y, { font: bold, size: 11 });
  drawText(formatAmount(data.amount, data.currency), pageW - margin - 60, y, { font: bold, size: 11, color: blue });

  // ── Footer ───────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width: pageW, height: 36, color: navy });
  drawText("Shane McCaw Consulting  |  Lead Microsoft 365 Architect  |  NASA", margin, 20, {
    size: 8, color: rgb(0.7, 0.8, 0.9),
  });
  drawText(`Generated ${formatDate(new Date())}`, pageW - 170, 20, { size: 8, color: rgb(0.5, 0.6, 0.7) });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
