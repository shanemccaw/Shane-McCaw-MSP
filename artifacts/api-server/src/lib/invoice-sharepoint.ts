import { db, invoicesTable, usersTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { graphCredentialsPresent, createSiteFolder, uploadFileToSharePoint } from "./graph";
import { generateInvoicePdf } from "./invoice-pdf";

/**
 * Fire-and-forget: generate a PDF for the given invoice and upload it to the
 * client's SharePoint Invoices folder. Silently skips if Graph is not configured
 * or the client has no linked SharePoint site.
 */
export async function uploadInvoiceToSharePoint(invoiceId: number): Promise<void> {
  if (!graphCredentialsPresent()) {
    logger.warn({ invoiceId }, "uploadInvoiceToSharePoint: Graph credentials missing — skipping");
    return;
  }

  try {
    // ── Fetch invoice + client user + optional project ──────────────────────
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
    if (!invoice) {
      logger.warn({ invoiceId }, "uploadInvoiceToSharePoint: invoice not found");
      return;
    }

    const [client] = await db.select().from(usersTable).where(eq(usersTable.id, invoice.clientUserId)).limit(1);
    if (!client?.sharepointSiteId) {
      logger.warn({ invoiceId, clientUserId: invoice.clientUserId }, "uploadInvoiceToSharePoint: client has no SharePoint site — skipping");
      return;
    }

    let projectTitle: string | null = null;
    if (invoice.projectId) {
      const [project] = await db.select({ title: projectsTable.title }).from(projectsTable).where(eq(projectsTable.id, invoice.projectId)).limit(1);
      projectTitle = project?.title ?? null;
    }

    // ── Determine folder path ────────────────────────────────────────────────
    const folderPath = projectTitle ? `${projectTitle}/Invoices` : "Invoices";

    // ── Ensure the Invoices subfolder exists ─────────────────────────────────
    if (projectTitle) {
      await createSiteFolder(client.sharepointSiteId, projectTitle, "Invoices");
    } else {
      await createSiteFolder(client.sharepointSiteId, "/", "Invoices");
    }

    // ── Generate PDF ─────────────────────────────────────────────────────────
    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      createdAt: invoice.createdAt,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      status: invoice.status,
      description: invoice.description,
      amount: invoice.amount,
      currency: invoice.currency,
      clientName: client.name,
      clientEmail: client.email,
      clientCompany: client.company,
      projectTitle,
    });

    // ── Upload to SharePoint ─────────────────────────────────────────────────
    const filename = `Invoice-${invoice.invoiceNumber}.pdf`;
    const webUrl = await uploadFileToSharePoint(
      client.sharepointSiteId,
      folderPath,
      filename,
      pdfBuffer,
      "application/pdf",
    );

    if (!webUrl) {
      logger.warn({ invoiceId, folderPath }, "uploadInvoiceToSharePoint: upload returned null");
      return;
    }

    // ── Persist the SharePoint URL back on the invoice ───────────────────────
    await db.update(invoicesTable)
      .set({ sharepointFileUrl: webUrl })
      .where(eq(invoicesTable.id, invoiceId));

    logger.info({ invoiceId, webUrl }, "uploadInvoiceToSharePoint: invoice PDF uploaded to SharePoint");
  } catch (err) {
    logger.error({ err, invoiceId }, "uploadInvoiceToSharePoint: unexpected error");
  }
}
