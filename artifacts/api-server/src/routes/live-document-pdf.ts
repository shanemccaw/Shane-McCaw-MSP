import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, mspsTable, documentPrintTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { buildLiveDocumentPrintUrl } from "../lib/portal-url.ts";
import { renderLiveDocumentToPdf } from "../lib/insight-pdf.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// Git #1043 (Epic #660, Phase 1). The Copilot Readiness journey's seven
// "live spine" reports (JOURNEY_LIVE_DOCUMENTS in
// artifacts/msp-portal/src/components/copilot-journey/journeyTokens.ts —
// kept in sync with that list by hand, the same cross-app-duplication
// pattern portal-documents.ts's LIVE_RENDERED_DOC_TYPES already uses).
// insights-documents / insightsGeneratedDocumentsTable / printTokensTable /
// portal-documents.ts are DEPRECATED for this feature and are not touched or
// reused here — this is a clean route against the live-rendered document set
// only. The title is needed for the downloaded file's name; there is no row
// to read it off since these documents have id: null by design.
const LIVE_DOCUMENT_TITLES: Record<string, string> = {
  copilot_readiness: "Copilot Readiness, Safety & Enablement Report",
  security_posture_report: "Microsoft 365 Security Posture & Blast Radius Report",
  governance_maturity_report: "Microsoft 365 Governance Posture Report",
  compliance_alignment_report: "Microsoft 365 Compliance & Regulatory Alignment Report",
  license_optimization_report: "Copilot Licensing Alignment Report",
  adoption_report: "Copilot Adoption & Workflow Readiness Report",
  operational_health_report: "Microsoft 365 Operational Health & Service Integrity Report",
};

router.get("/portal/live-documents/:docType/pdf", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const docType = String(req.params.docType ?? "");
    const title = LIVE_DOCUMENT_TITLES[docType];
    if (!title) {
      res.status(404).json({ error: "Unknown live document type" });
      return;
    }

    const [userRow] = await db.select({ mspId: usersTable.mspId }).from(usersTable)
      .where(eq(usersTable.id, userId)).limit(1);
    const [mspRow] = userRow?.mspId
      ? await db.select({ slug: mspsTable.slug }).from(mspsTable).where(eq(mspsTable.id, userRow.mspId)).limit(1)
      : [];
    if (!mspRow?.slug) {
      log.error({ userId, docType }, "live document pdf: could not resolve MSP slug for user");
      res.status(500).json({ error: "Could not resolve your account for PDF export" });
      return;
    }

    const printToken = randomBytes(32).toString("hex");
    await db.insert(documentPrintTokensTable).values({
      token: printToken,
      userId,
      docType,
      // Comfortably longer than a headless print run, far shorter than any
      // real session — this token exists only to get one Chromium tab from
      // "just navigated" to "already printed".
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    });

    const printUrl = buildLiveDocumentPrintUrl(mspRow.slug, docType, printToken);
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderLiveDocumentToPdf(printUrl);
    } catch (err) {
      log.error({ err, userId, docType }, "live document pdf: renderLiveDocumentToPdf failed");
      res.status(502).json({ error: "Could not render this report to PDF right now — please try again" });
      return;
    }

    const safeTitle = title
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.end(pdfBuffer);
  } catch (err) {
    req.log.error({ err }, "portal/live-documents/:docType/pdf failed");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

export default router;
