import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, servicesTable, contractsTable, contractTemplatesTable, couponsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { resolveTypeAttributesMonthlyPriceCents } from "../lib/catalog-pricing.ts";
import { graphCredentialsPresent, uploadFileToClientContracts } from "../lib/graph.ts";
import { createAuditLog } from "../lib/audit.ts";
import { ensureClientAccount } from "../lib/direct-tenant-provisioning.ts";
import { logger } from "../lib/logger.ts";
import path from "path";
import fs from "fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

interface ContractPdfOptions {
  contractId: number;
  signerName: string;
  serviceName: string;
  servicePrice: string;
  billingType?: "one_time" | "recurring_monthly";
  serviceDeliverables: string;
  serviceTurnaround: string;
  signedAt: Date;
  signatureDataUrl?: string;
  contractTemplateBody?: string; // When provided, replaces hardcoded sections with admin-authored content
  selectionsSummary?: string;    // Plain-text wizard selection summary, injected after price row
  appendBody?: string;           // Extra clauses appended after template/standard sections (before signature)
}

async function generateContractPdf(opts: ContractPdfOptions): Promise<{ filename: string; buffer: Buffer; localFilePath: string }> {
  const {
    contractId, signerName, serviceName, servicePrice,
    billingType = "one_time", serviceDeliverables, serviceTurnaround,
    signedAt, signatureDataUrl, contractTemplateBody, selectionsSummary, appendBody,
  } = opts;

  const pdfDoc = await PDFDocument.create();
  const boldFont  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regFont   = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const PAGE_W    = 595;
  const PAGE_H    = 842;
  const MARGIN    = 60;
  const CONTENT_W = PAGE_W - MARGIN * 2; // 475
  const MIN_Y     = 80;

  const navy    = rgb(0.039, 0.145, 0.251);  // #0A2540
  const blue    = rgb(0,     0.471, 0.831);  // #0078D4
  const greyClr = rgb(0.420, 0.443, 0.502);  // #6B7280
  const darkTxt = rgb(0.216, 0.255, 0.318);  // #374151
  const borderC = rgb(0.886, 0.910, 0.945);  // #e2e8f0
  const offWht  = rgb(0.969, 0.976, 0.988);  // #F7F9FC
  const white   = rgb(1,     1,     1);
  const whtDim  = rgb(0.82,  0.86,  0.91);

  // ── Page management ─────────────────────────────────────────────────────────
  function newBodyPage() {
    const p = pdfDoc.addPage([PAGE_W, PAGE_H]);
    p.drawRectangle({ x: 0, y: PAGE_H - 22, width: PAGE_W, height: 22, color: navy });
    p.drawText("Shane McCaw Consulting LLC  —  Service Agreement", {
      x: MARGIN, y: PAGE_H - 16, font: boldFont, size: 8, color: whtDim,
    });
    return p;
  }

  // ── Text helpers ─────────────────────────────────────────────────────────────
  // Rough Helvetica char-width estimate: size * 0.55 per char
  function wrapText(str: string, maxW: number, sz: number): string[] {
    const charsPerLine = Math.floor(maxW / (sz * 0.55));
    const words = str.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (cand.length > charsPerLine) { if (cur) lines.push(cur); cur = w; }
      else { cur = cand; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // Draw Electric Blue uppercase heading + light rule underneath; returns next y
  function drawSectionHeading(page: ReturnType<typeof newBodyPage>, label: string, x: number, pageY: number): number {
    page.drawText(label.toUpperCase(), { x, y: pageY, font: boldFont, size: 8.5, color: blue });
    const ruleY = pageY - 5;
    page.drawLine({ start: { x, y: ruleY }, end: { x: x + CONTENT_W, y: ruleY }, thickness: 1, color: borderC });
    return ruleY - 10;
  }

  // ── Cursor state (mutated by ensureSpace) ────────────────────────────────────
  let currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H; // set properly after drawing the header block

  function ensureSpace(needed: number) {
    if (y - needed < MIN_Y) {
      currentPage = newBodyPage();
      y = PAGE_H - 40;
    }
  }

  // ── PAGE 1: DEEP NAVY HEADER BLOCK ──────────────────────────────────────────
  const HEADER_H = 100;
  const HEADER_Y = PAGE_H - HEADER_H; // top of content-area (bottom of block)
  currentPage.drawRectangle({ x: 0, y: HEADER_Y, width: PAGE_W, height: HEADER_H, color: navy });

  // "SERVICE AGREEMENT" label
  currentPage.drawText("SERVICE AGREEMENT", {
    x: MARGIN, y: HEADER_Y + HEADER_H - 22,
    font: boldFont, size: 7.5, color: rgb(0.5, 0.63, 0.75),
  });

  // Company name
  currentPage.drawText("Shane McCaw Consulting LLC", {
    x: MARGIN, y: HEADER_Y + HEADER_H - 40,
    font: boldFont, size: 14, color: white,
  });

  // Metadata row: DATE / PROVIDER / CLIENT
  const signedDate = signedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const metaY = HEADER_Y + HEADER_H - 63;
  const metaPairs: [string, string, number][] = [
    ["DATE",     signedDate,                       MARGIN],
    ["PROVIDER", "Shane McCaw Consulting LLC",     MARGIN + 145],
    ["CLIENT",   signerName,                       MARGIN + 330],
  ];
  for (const [lbl, val, mx] of metaPairs) {
    currentPage.drawText(lbl, { x: mx, y: metaY,      font: boldFont, size: 6.5, color: rgb(0.45, 0.58, 0.70) });
    const vLines = wrapText(val, 130, 8);
    vLines.forEach((ln, i) => {
      currentPage.drawText(ln, { x: mx, y: metaY - 11 - i * 10, font: regFont, size: 8, color: whtDim });
    });
  }

  y = HEADER_Y - 20; // gap below the header block

  // ── SERVICES TABLE ───────────────────────────────────────────────────────────
  const COL1_W = 290; // Service & Deliverables
  const COL2_W = 105; // Price
  const COL3_W = CONTENT_W - COL1_W - COL2_W; // Type (~80)
  const ROW_PAD = 8;
  const THEAD_H = 26;

  // Measure data-row height
  const delivLines = wrapText(serviceDeliverables, COL1_W - 16, 8.5);
  const selLines = selectionsSummary
    ? selectionsSummary.split("\n").filter(l => l.trim() && !l.trim().toLowerCase().startsWith("customisation"))
    : [];
  const dataRowH = Math.max(
    ROW_PAD * 2 + 12 + delivLines.length * 11 + (selLines.length > 0 ? 4 + selLines.length * 11 : 0),
    30,
  );
  const tableH = THEAD_H + dataRowH;

  ensureSpace(tableH + 24);

  const tableTop    = y;
  const tableBottom = tableTop - tableH;
  const TABLE_X     = MARGIN;

  // Outer border
  currentPage.drawRectangle({
    x: TABLE_X, y: tableBottom, width: CONTENT_W, height: tableH,
    borderColor: borderC, borderWidth: 1, color: white,
  });

  // Header row background
  currentPage.drawRectangle({
    x: TABLE_X, y: tableTop - THEAD_H, width: CONTENT_W, height: THEAD_H, color: offWht,
  });
  // Header row bottom border
  currentPage.drawLine({
    start: { x: TABLE_X, y: tableTop - THEAD_H },
    end:   { x: TABLE_X + CONTENT_W, y: tableTop - THEAD_H },
    thickness: 1, color: borderC,
  });

  // Column separator lines (full table height)
  for (const cx of [TABLE_X + COL1_W, TABLE_X + COL1_W + COL2_W]) {
    currentPage.drawLine({
      start: { x: cx, y: tableBottom },
      end:   { x: cx, y: tableTop },
      thickness: 0.5, color: borderC,
    });
  }

  // Column header labels
  const thY = tableTop - THEAD_H + (THEAD_H - 7) / 2 + 1;
  currentPage.drawText("SERVICE & DELIVERABLES", { x: TABLE_X + 10, y: thY, font: boldFont, size: 7, color: greyClr });

  const priceHdr = "PRICE";
  const priceHdrW = boldFont.widthOfTextAtSize(priceHdr, 7);
  currentPage.drawText(priceHdr, {
    x: TABLE_X + COL1_W + COL2_W - 10 - priceHdrW, y: thY, font: boldFont, size: 7, color: greyClr,
  });

  const typeHdr = "TYPE";
  const typeHdrW = boldFont.widthOfTextAtSize(typeHdr, 7);
  currentPage.drawText(typeHdr, {
    x: TABLE_X + COL1_W + COL2_W + COL3_W - 10 - typeHdrW, y: thY, font: boldFont, size: 7, color: greyClr,
  });

  // Data row content
  let rowY = tableTop - THEAD_H - ROW_PAD;

  // Service name (bold navy)
  currentPage.drawText(serviceName, { x: TABLE_X + 10, y: rowY, font: boldFont, size: 9, color: navy });
  rowY -= 13;

  // Deliverables (grey, smaller)
  for (const dln of delivLines) {
    currentPage.drawText(dln, { x: TABLE_X + 10, y: rowY, font: regFont, size: 8, color: greyClr });
    rowY -= 11;
  }

  // Wizard selections sub-list
  if (selLines.length > 0) {
    rowY -= 3;
    for (const sln of selLines) {
      currentPage.drawText(sln, { x: TABLE_X + 18, y: rowY, font: regFont, size: 7.5, color: greyClr });
      rowY -= 11;
    }
  }

  // Price (right-aligned in col 2, bold blue)
  const priceDisplay = billingType === "recurring_monthly" ? `${servicePrice}/month` : servicePrice;
  const priceW = boldFont.widthOfTextAtSize(priceDisplay, 9);
  currentPage.drawText(priceDisplay, {
    x: TABLE_X + COL1_W + COL2_W - 10 - priceW,
    y: tableTop - THEAD_H - ROW_PAD,
    font: boldFont, size: 9, color: blue,
  });

  // Type (right-aligned in col 3, grey)
  const typeDisplay = billingType === "recurring_monthly" ? "monthly" : "one-time";
  const typeW = regFont.widthOfTextAtSize(typeDisplay, 8);
  currentPage.drawText(typeDisplay, {
    x: TABLE_X + COL1_W + COL2_W + COL3_W - 10 - typeW,
    y: tableTop - THEAD_H - ROW_PAD,
    font: regFont, size: 8, color: greyClr,
  });

  y = tableBottom - 18;

  // ── CONTRACT SECTIONS ────────────────────────────────────────────────────────
  const isRecurring = billingType === "recurring_monthly";

  if (contractTemplateBody) {
    // Admin-authored contract body (variable substitution already applied by caller)
    for (const rawLine of contractTemplateBody.split("\n")) {
      const trimmed = rawLine.trimEnd();
      if (trimmed.startsWith("# ")) {
        ensureSpace(32);
        y = drawSectionHeading(currentPage, trimmed.slice(2), MARGIN, y);
      } else if (trimmed.startsWith("## ")) {
        ensureSpace(22);
        currentPage.drawText(trimmed.slice(3), { x: MARGIN, y, font: boldFont, size: 10, color: navy });
        y -= 16;
      } else if (trimmed === "") {
        y -= 6;
      } else {
        for (const wl of wrapText(trimmed, CONTENT_W - 10, 9.5)) {
          ensureSpace(14);
          currentPage.drawText(wl, { x: MARGIN + 4, y, font: regFont, size: 9.5, color: darkTxt });
          y -= 13;
        }
      }
    }
  } else {
    const sections: [string, string][] = [
      ["1. Services",
        "Consultant agrees to deliver the above-listed service to Client per the deliverables and terms specified in the table above."],
      ["2. Fees & Payment",
        isRecurring
          ? "Monthly retainer services are billed at the stated monthly rate, payable in advance on a recurring monthly basis. Either party may cancel a monthly subscription with 30 days written notice. Cancellation takes effect at the end of the current billing period. Monthly retainer fees for the current period are non-refundable on cancellation."
          : "The fixed fee for this engagement is payable in full at checkout before work commences. No additional charges will be incurred for the standard deliverables listed above. No refunds will be issued for one-time services once work has commenced."],
      ["3. Scope",
        "This agreement covers only the deliverables specified above. Any additional work beyond this scope must be agreed in writing and may be subject to additional fees."],
      ["4. Delivery",
        isRecurring
          ? "For monthly retainers, Consultant will perform the described ongoing services throughout each billing period."
          : `Consultant will deliver the agreed outputs within the stated turnaround period (${serviceTurnaround}) after receipt of payment and any required access or information from Client. Work will not commence until both payment is confirmed and all necessary access has been granted.`],
      ["5. Revisions (One-Time Services)",
        "One round of revisions is included within the scope of each one-time service. Additional revisions are available at Consultant's standard hourly rate."],
      ["6. Confidentiality",
        "Each party agrees to keep the other party's confidential information confidential and not to disclose it to any third party without prior written consent. This obligation survives termination of this agreement."],
      ["7. Intellectual Property",
        "Upon receipt of full payment (or, for ongoing retainers, upon payment for the relevant billing period), all deliverables produced by Consultant for Client become the sole property of Client."],
      ["8. Limitation of Liability",
        "Consultant's total liability under this agreement shall not exceed the total fees paid in the 12 months prior to any claim. Consultant is not liable for any indirect, incidental, or consequential damages."],
      ["9. Independent Contractor",
        "Consultant is an independent contractor and not an employee of Client. Nothing in this agreement shall create any partnership, joint venture, agency, franchise, or employment relationship between the parties."],
      ["10. Governing Law",
        "This agreement is governed by the laws of the State of Virginia, United States. Any disputes shall be resolved in the courts of Virginia."],
      ["11. Entire Agreement",
        "This document constitutes the entire agreement between the parties with respect to this engagement and supersedes all prior discussions and representations. Amendments must be made in writing."],
    ];

    for (const [heading, body] of sections) {
      ensureSpace(42);
      y = drawSectionHeading(currentPage, heading, MARGIN, y);
      for (const wl of wrapText(body, CONTENT_W - 10, 9.5)) {
        ensureSpace(14);
        currentPage.drawText(wl, { x: MARGIN + 4, y, font: regFont, size: 9.5, color: darkTxt });
        y -= 13;
      }
      y -= 10;
    }
  }

  // ── APPEND BODY (extra clauses, e.g. testimonial obligation) ─────────────────
  if (appendBody) {
    y -= 10;
    for (const rawLine of appendBody.split("\n")) {
      const trimmed = rawLine.trimEnd();
      if (trimmed.startsWith("# ")) {
        ensureSpace(32);
        y = drawSectionHeading(currentPage, trimmed.slice(2), MARGIN, y);
      } else if (trimmed.startsWith("## ")) {
        ensureSpace(22);
        currentPage.drawText(trimmed.slice(3), { x: MARGIN, y, font: boldFont, size: 10, color: navy });
        y -= 16;
      } else if (trimmed === "---") {
        ensureSpace(14);
        currentPage.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.75, color: borderC });
        y -= 10;
      } else if (trimmed === "") {
        y -= 6;
      } else if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        ensureSpace(22);
        currentPage.drawText(trimmed.slice(2, -2), { x: MARGIN, y, font: boldFont, size: 10, color: navy });
        y -= 16;
      } else {
        for (const wl of wrapText(trimmed, CONTENT_W - 10, 9.5)) {
          ensureSpace(14);
          currentPage.drawText(wl, { x: MARGIN + 4, y, font: regFont, size: 9.5, color: darkTxt });
          y -= 13;
        }
      }
    }
  }

  // ── SIGNATURE PAGE ───────────────────────────────────────────────────────────
  const sigPage = newBodyPage();
  let sy = PAGE_H - 56;

  sigPage.drawText("Electronic Signature", { x: MARGIN, y: sy, font: boldFont, size: 16, color: navy });
  sy -= 6;
  sigPage.drawLine({ start: { x: MARGIN, y: sy }, end: { x: MARGIN + CONTENT_W, y: sy }, thickness: 1.5, color: blue });
  sy -= 22;

  sigPage.drawText(
    "By signing below, the Client confirms they have read, understood, and agreed to the Service Agreement.",
    { x: MARGIN, y: sy, font: regFont, size: 10, color: greyClr },
  );
  sy -= 30;

  if (signatureDataUrl && signatureDataUrl.startsWith("data:image/png;base64,")) {
    try {
      const base64Data = signatureDataUrl.replace("data:image/png;base64,", "");
      const sigBytes   = Buffer.from(base64Data, "base64");
      const sigImg     = await pdfDoc.embedPng(sigBytes);
      const imgW       = 240;
      const imgH       = Math.round((sigImg.height / sigImg.width) * imgW);
      sigPage.drawImage(sigImg, { x: MARGIN, y: sy - imgH, width: imgW, height: imgH });
      sy -= imgH + 8;
    } catch {
      sigPage.drawRectangle({ x: MARGIN, y: sy - 60, width: 240, height: 60, color: offWht, borderColor: borderC, borderWidth: 1 });
      sigPage.drawText("[Signature image could not be rendered]", { x: MARGIN + 10, y: sy - 38, font: regFont, size: 9, color: greyClr });
      sy -= 70;
    }
  } else {
    sigPage.drawRectangle({ x: MARGIN, y: sy - 60, width: 240, height: 60, color: offWht, borderColor: borderC, borderWidth: 1 });
    sigPage.drawText("[Electronic signature on file]", { x: MARGIN + 10, y: sy - 38, font: regFont, size: 9, color: greyClr });
    sy -= 70;
  }

  sigPage.drawLine({ start: { x: MARGIN, y: sy }, end: { x: MARGIN + 260, y: sy }, thickness: 0.75, color: navy });
  sy -= 12;
  sigPage.drawText(`${signerName}  (Client)`, { x: MARGIN, y: sy, font: regFont, size: 10, color: navy });
  sy -= 14;
  sigPage.drawText(`Signed electronically on ${signedDate}`, { x: MARGIN, y: sy, font: regFont, size: 9, color: greyClr });
  sy -= 10;
  sigPage.drawText(`Contract ref: ${contractId}`, { x: MARGIN, y: sy, font: regFont, size: 8, color: greyClr });
  sy -= 40;

  sigPage.drawText("For Shane McCaw Consulting LLC:", { x: MARGIN, y: sy, font: regFont, size: 10, color: navy });
  sy -= 14;
  sigPage.drawText("Shane McCaw", { x: MARGIN, y: sy, font: boldFont, size: 10, color: navy });
  sy -= 14;
  sigPage.drawText("Lead Microsoft 365 Architect & Consultant", { x: MARGIN, y: sy, font: regFont, size: 9, color: greyClr });

  // Footer
  sigPage.drawText(
    "This document was generated electronically and is legally binding. Shane McCaw Consulting LLC  |  info@shanemccaw.com",
    { x: MARGIN, y: 30, font: regFont, size: 7.5, color: greyClr },
  );

  // ── Save to disk ─────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  const invoicesDir = path.join(UPLOADS_BASE, "invoices");
  fs.mkdirSync(invoicesDir, { recursive: true });
  const filename = `contract-${contractId}-${Date.now()}.pdf`;
  const localFilePath = path.join(invoicesDir, filename);
  fs.writeFileSync(localFilePath, pdfBuffer);
  return { filename, buffer: pdfBuffer, localFilePath };
}

router.post("/portal/onboarding/contract", async (req: Request, res: Response) => {
  // Optional auth: use bearer JWT if present; otherwise treat as guest and require guestEmail in body
  let resolvedUserId: number | null = null;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      try {
        const payload = jwt.verify(authHeader.slice(7), jwtSecret) as { id: number };
        resolvedUserId = payload.id;
      } catch { /* invalid token — fall through to guest */ }
    }
  }

  let resolvedGuestEmail: string | null = null;
  if (resolvedUserId === null) {
    const { guestEmail } = req.body as { guestEmail?: string };
    if (!guestEmail?.trim()) {
      res.status(401).json({ error: "Please provide your email address to continue." });
      return;
    }
    resolvedGuestEmail = guestEmail.trim().toLowerCase();
  }

  const userId = resolvedUserId; // null for guests; contracts.userId is nullable
  const {
    serviceId, serviceIds: rawServiceIds, signatureData, signerName, wizardSelections, couponCode: bodyCouponCode,
    guestName, guestCompany, guestPhone, guestAddress, guestCity, guestState, guestZip,
    appRegPermissionsAgreed, seats: rawContractSeats,
  } = req.body as {
    serviceId?: number; serviceIds?: number[]; signatureData?: string; signerName?: string;
    wizardSelections?: Record<string, { stepId: string; stepTitle?: string; optionId: string; optionLabel?: string; priceAdjustment?: number }[]>;
    couponCode?: string;
    guestName?: string; guestCompany?: string; guestPhone?: string;
    guestAddress?: string; guestCity?: string; guestState?: string; guestZip?: string;
    appRegPermissionsAgreed?: boolean;
    seats?: number;
  };
  const contractSeats = Math.max(1, Number(rawContractSeats) || 1);

  // Support both single serviceId (legacy) and serviceIds array (multi-service)
  const resolvedServiceIds: number[] = rawServiceIds?.length
    ? rawServiceIds
    : serviceId
      ? [serviceId]
      : [];

  if (resolvedServiceIds.length === 0 || !signerName?.trim()) {
    res.status(400).json({ error: "serviceId(s) and signerName are required" });
    return;
  }

  // Fetch services first so we can gate signature validation on service type
  const fetchedSvcs = await db.select().from(servicesTable)
    .where(sql`${servicesTable.id} = ANY(ARRAY[${sql.join(resolvedServiceIds.map(id => sql`${id}`), sql`, `)}]::int[])`);
  if (fetchedSvcs.length !== resolvedServiceIds.length) {
    res.status(404).json({ error: "One or more services not found" });
    return;
  }
  // Preserve exact input order so contractIds[i] always pairs with serviceIds[i]
  const svcMap = new Map(fetchedSvcs.map(s => [s.id, s]));
  const services = resolvedServiceIds.map(id => svcMap.get(id)!);

  // Only project and retainer service types require a drawn signature
  const anyRequiresSignature = services.some(
    s => s.serviceType === "project" || s.serviceType === "retainer"
  );
  if (anyRequiresSignature) {
    if (!signatureData || signatureData.trim().length < 100) {
      res.status(400).json({ error: "A drawn signature is required to sign the agreement" });
      return;
    }
    if (!signatureData.startsWith("data:image/")) {
      res.status(400).json({ error: "Invalid signature format" });
      return;
    }
  }

  const ipAddress = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
  const userAgent = req.headers["user-agent"] ?? null;

  const createdContracts: typeof contractsTable.$inferSelect[] = [];

  for (const svc of services) {
    // Fetch admin-authored contract template for this service (if any)
    const [contractTemplate] = await db
      .select()
      .from(contractTemplatesTable)
      .where(eq(contractTemplatesTable.serviceId, svc.id))
      .limit(1);

    // Substitute template variables into the body
    // ── Compute server-side wizard price for this service ───────────────
    let computedFinalPrice: number | null = null;
    const svcSelections = wizardSelections?.[String(svc.id)] ?? [];

    const rawWorkflow = svc.orderWorkflow as Array<unknown> | null;
    const hasWorkflow = Array.isArray(rawWorkflow) && rawWorkflow.length > 0 && svc.basePrice;

    if (hasWorkflow) {
      // Service has a wizard — selections are REQUIRED and strictly validated
      const workflow = rawWorkflow as Array<{ id: string; title: string; options: Array<{ id: string; label: string; priceAdjustment: number }> }>;

      // (1) Exactly one selection per step required — no missing, no duplicates
      const coveredStepIds = new Set<string>();
      for (const sel of svcSelections) {
        if (coveredStepIds.has(sel.stepId)) {
          res.status(400).json({ error: `Duplicate selection for step "${sel.stepId}" in service ${svc.id}` });
          return;
        }
        coveredStepIds.add(sel.stepId);
      }
      for (const wfStep of workflow) {
        if (!coveredStepIds.has(wfStep.id)) {
          res.status(400).json({ error: `Missing selection for required step "${wfStep.id}" (${wfStep.title}) in service ${svc.id}` });
          return;
        }
      }

      // (2) All step/option IDs must exist in the stored workflow
      let total = parseFloat(String(svc.basePrice));
      for (const sel of svcSelections) {
        const wStep = workflow.find(s => s.id === sel.stepId);
        if (!wStep) {
          res.status(400).json({ error: `Unknown step id "${sel.stepId}" for service ${svc.id}` });
          return;
        }
        const wOpt = wStep.options.find(o => o.id === sel.optionId);
        if (!wOpt) {
          res.status(400).json({ error: `Unknown option id "${sel.optionId}" for step "${sel.stepId}" in service ${svc.id}` });
          return;
        }
        total += wOpt.priceAdjustment;
      }

      // (3) Clamp to maxPrice ceiling if set
      if (svc.maxPrice) {
        const max = parseFloat(String(svc.maxPrice));
        total = Math.min(total, max);
      }
      computedFinalPrice = Math.round(total * 100) / 100;
    }

    const signedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const effectivePriceStr = (() => {
      if (computedFinalPrice != null) return `$${computedFinalPrice.toLocaleString("en-US")}`;
      // Same resolver checkout charges with (seatCountFloor + flatMonthlySurcharge
      // included) so the signed contract/PDF names the real monthly price — a
      // naive ppu × seats here previously understated per-seat tiers on the
      // legal document itself.
      const taCents = resolveTypeAttributesMonthlyPriceCents(svc, contractSeats);
      if (taCents > 0) return `$${(taCents / 100).toLocaleString("en-US")}`;
      if (svc.price) return `$${parseFloat(String(svc.price)).toLocaleString("en-US")}`;
      return "—";
    })();

    // Build a plain-text summary of wizard selections for the contract body/PDF
    let selectionsSummary = "";
    if (svcSelections.length > 0 && hasWorkflow) {
      const wf = rawWorkflow as Array<{ id: string; title: string; options: Array<{ id: string; label: string; priceAdjustment: number }> }>;
      const lines = svcSelections.map(sel => {
        const wStep = wf.find(s => s.id === sel.stepId);
        const wOpt = wStep?.options.find(o => o.id === sel.optionId);
        if (!wStep || !wOpt) return null;
        const adj = wOpt.priceAdjustment !== 0
          ? ` (${wOpt.priceAdjustment > 0 ? "+" : ""}$${wOpt.priceAdjustment.toLocaleString("en-US")})`
          : "";
        return `• ${wStep.title}: ${wOpt.label}${adj}`;
      }).filter(Boolean);
      if (lines.length > 0) {
        selectionsSummary = "Customisation selections:\n" + lines.join("\n");
      }
    }

    let templateBody = contractTemplate?.body?.trim()
      ? contractTemplate.body
          .replace(/\{\{client_name\}\}/g, signerName.trim())
          .replace(/\{\{service_name\}\}/g, svc.name)
          .replace(/\{\{price\}\}/g, effectivePriceStr)
          .replace(/\{\{date\}\}/g, signedDate)
          .replace(/\{\{selections_summary\}\}/g, selectionsSummary)
      : undefined;

    // ── Testimonial obligation clause (TESTIMONIAL coupon) ────────────────
    // The coupon code is passed from the frontend at signing time (before checkout).
    // Checkout also authoritatively re-checks and updates agreementBody if needed.
    const TESTIMONIAL_MARKER = "Testimonial & Case Study Obligation";
    const TESTIMONIAL_CLAUSE = `\n\n---\n\n**Testimonial & Case Study Obligation**\n\nThe discounted rate applied to this engagement was granted in exchange for the Client's agreement to provide a written testimonial or short case study within 5 days of project completion. The testimonial or case study will describe the Client's experience working with Shane McCaw Consulting and may be used by Shane McCaw Consulting for marketing purposes. Failure to deliver the testimonial or case study within the stated period does not retroactively alter the agreed service price, but the discount benefit will not be available on future engagements until the obligation is fulfilled.`;
    let pdfAppendBody: string | undefined;

    if (bodyCouponCode?.trim()) {
      const [appliedCouponRow] = await db
        .select({ requiresTestimonial: couponsTable.requiresTestimonial })
        .from(couponsTable)
        .where(eq(couponsTable.code, bodyCouponCode.trim().toUpperCase()))
        .limit(1);
      if (appliedCouponRow?.requiresTestimonial) {
        if (templateBody) {
          // Append clause to admin-authored template (both DB record and PDF use it)
          templateBody = templateBody + TESTIMONIAL_CLAUSE;
        } else {
          // No admin template: standard PDF sections render via the normal path.
          // The testimonial clause is appended separately via appendBody so the
          // standard legal sections are preserved in the generated PDF.
          pdfAppendBody = TESTIMONIAL_CLAUSE.trimStart();
        }
      }
    }

    const [contract] = await db.insert(contractsTable).values({
      userId: resolvedUserId,
      guestEmail: resolvedGuestEmail,
      serviceId: svc.id,
      signatureData,
      signerName: signerName.trim(),
      ipAddress,
      userAgent,
      contractVersion: contractTemplate?.version ?? "v1",
      finalPrice: computedFinalPrice != null ? String(computedFinalPrice) : null,
      wizardSelections: svcSelections.length > 0 ? svcSelections as never : null,
      // When no template exists but a testimonial clause applies, store the clause
      // in agreementBody so there is a DB record; the PDF renders it via appendBody.
      agreementBody: templateBody ?? (pdfAppendBody ?? null),
      appRegPermissionsAgreed: appRegPermissionsAgreed === true,
    }).returning();

    // ── Generate signed PDF immediately at signing time ──────────────────
    try {
      const { filename: pdfFilename, buffer: pdfBuffer, localFilePath } = await generateContractPdf({
        contractId: contract.id,
        signerName: signerName.trim(),
        serviceName: svc.name,
        servicePrice: effectivePriceStr,
        billingType: svc.billingType as "one_time" | "recurring_monthly",
        serviceDeliverables: Array.isArray(svc.deliverables) && svc.deliverables.length > 0
          ? svc.deliverables.join(", ")
          : "as described on the service page",
        serviceTurnaround: svc.turnaround ?? "see service details",
        signedAt: contract.signedAt ?? new Date(),
        signatureDataUrl: signatureData,
        contractTemplateBody: templateBody,
        selectionsSummary: selectionsSummary || undefined,
        appendBody: pdfAppendBody,
      });

      // ── Upload to SharePoint Contracts folder ──────────────────────────
      let sharepointFileUrl: string | null = null;
      let sharepointFileId: string | null = null;

      const [clientUser] = resolvedUserId !== null
        ? await db.select({ sharepointSiteId: usersTable.sharepointSiteId })
            .from(usersTable).where(eq(usersTable.id, resolvedUserId))
        : [null];

      if (!clientUser?.sharepointSiteId) {
        req.log.warn({ contractId: contract.id }, "contract signing: client has no SharePoint site — PDF saved locally only");
      } else if (!graphCredentialsPresent()) {
        req.log.warn({ contractId: contract.id }, "contract signing: Graph credentials missing — PDF saved locally only");
      } else {
        const spResult = await uploadFileToClientContracts(clientUser.sharepointSiteId, pdfFilename, pdfBuffer);
        if (spResult) {
          sharepointFileUrl = spResult.webUrl;
          sharepointFileId = spResult.fileId;
          req.log.info({ contractId: contract.id, sharepointFileUrl }, "contract PDF uploaded to SharePoint");
        } else {
          req.log.warn({ contractId: contract.id }, "contract signing: SharePoint upload failed — PDF saved locally only");
        }
      }

      await db.update(contractsTable)
        .set({ pdfFilename, sharepointFileUrl, sharepointFileId, localFilePath })
        .where(eq(contractsTable.id, contract.id));
      createdContracts.push({ ...contract, pdfFilename, sharepointFileUrl, sharepointFileId, localFilePath });
    } catch (pdfErr) {
      req.log.error({ err: pdfErr }, "contract signing: PDF generation failed (non-fatal)");
      createdContracts.push(contract);
    }
  }

  // Audit the signing
  void createAuditLog({
    actorUserId: resolvedUserId ?? undefined,
    actorName: req.user?.name ?? req.user?.email ?? resolvedGuestEmail ?? "Guest",
    actorRole: "client",
    actionType: "contract_signed",
    entityType: "contract",
    entityId: createdContracts.map(c => c.id).join(","),
    entityLabel: services.map(s => s.name).join(", "),
    clientId: resolvedUserId ?? undefined,
    metadata: { signerName, serviceCount: createdContracts.length },
  });

  // ── Save guest profile fields (company, address, phone) at signing time ──────
  // The full account (with password) is created after Stripe payment, but we
  // pre-create the row here so the address is available from first login.
  if (resolvedUserId === null && resolvedGuestEmail) {
    try {
      const { id: guestUserId } = await ensureClientAccount(resolvedGuestEmail, guestName ?? signerName);
      // Only write fields that are not already populated to avoid clobbering existing data
      const [existing] = await db
        .select({ company: usersTable.company, phone: usersTable.phone, address: usersTable.address })
        .from(usersTable).where(eq(usersTable.id, guestUserId));
      const profilePatch: Record<string, string | null> = {};
      if (!existing?.company && guestCompany?.trim()) profilePatch.company = guestCompany.trim();
      if (!existing?.phone && guestPhone?.trim()) profilePatch.phone = guestPhone.trim();
      if (!existing?.address && guestAddress?.trim()) profilePatch.address = guestAddress.trim();
      if (guestCity?.trim()) profilePatch.addressCity = guestCity.trim();
      if (guestState?.trim()) profilePatch.addressState = guestState.trim();
      if (guestZip?.trim()) profilePatch.addressZip = guestZip.trim();
      if (Object.keys(profilePatch).length > 0) {
        await db.update(usersTable).set(profilePatch).where(eq(usersTable.id, guestUserId));
      }
    } catch (err) {
      req.log.warn({ err }, "contract signing: failed to pre-save guest profile fields (non-fatal)");
    }
  }

  // Return both legacy single-contract and new multi-contract formats
  if (createdContracts.length === 1) {
    res.status(201).json({ ...createdContracts[0], contractIds: [createdContracts[0].id] });
  } else {
    res.status(201).json({ contractIds: createdContracts.map(c => c.id), contracts: createdContracts });
  }
});

export default router;
