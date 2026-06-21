import { db, invoicesTable, usersTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { graphCredentialsPresent, createSiteFolder, uploadFileToSharePoint } from "./graph";
import { generateInvoicePdf } from "./invoice-pdf";

const SITE_POLL_ATTEMPTS = 20;
const SITE_POLL_INTERVAL_MS = 6_000;

/**
 * Fire-and-forget: generate a PDF for the given invoice and upload it to the
 * client's SharePoint Invoices folder. Silently skips if Graph is not configured.
 *
 * For newly-onboarded clients whose SharePoint site is still being provisioned,
 * the function polls the DB (up to ~2 minutes) until the site ID becomes
 * available before proceeding — this resolves the race where invoices are
 * inserted before provisionClientSite completes.
 */
export async function uploadInvoiceToSharePoint(invoiceId: number): Promise<void> {
  if (!graphCredentialsPresent()) {
    logger.warn({ invoiceId }, "uploadInvoiceToSharePoint: Graph credentials missing — skipping");
    return;
  }

  try {
    // ── Fetch invoice ────────────────────────────────────────────────────────
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
    if (!invoice) {
      logger.warn({ invoiceId }, "uploadInvoiceToSharePoint: invoice not found");
      return;
    }

    // ── Fetch client, polling until SharePoint site is provisioned ───────────
    // New clients won't have a site ID yet when the invoice is first created
    // (provisioning runs asynchronously and can take 15-60 seconds). We poll
    // the DB until the column is populated or we time out.
    let client: typeof usersTable.$inferSelect | undefined;
    for (let attempt = 0; attempt < SITE_POLL_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, SITE_POLL_INTERVAL_MS));
      }
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, invoice.clientUserId)).limit(1);
      client = row;
      if (client?.sharepointSiteId) break;
    }

    if (!client?.sharepointSiteId) {
      logger.warn(
        { invoiceId, clientUserId: invoice.clientUserId, attempts: SITE_POLL_ATTEMPTS },
        "uploadInvoiceToSharePoint: client has no SharePoint site after polling — skipping",
      );
      return;
    }

    // ── Resolve optional project title ───────────────────────────────────────
    let projectTitle: string | null = null;
    if (invoice.projectId) {
      const [project] = await db
        .select({ title: projectsTable.title })
        .from(projectsTable)
        .where(eq(projectsTable.id, invoice.projectId))
        .limit(1);
      projectTitle = project?.title ?? null;
    }

    // ── Determine folder path ────────────────────────────────────────────────
    const folderPath = projectTitle ? `${projectTitle}/Invoices` : "Invoices";

    // ── Ensure the Invoices subfolder exists (idempotent) ────────────────────
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
    await db
      .update(invoicesTable)
      .set({ sharepointFileUrl: webUrl })
      .where(eq(invoicesTable.id, invoiceId));

    logger.info({ invoiceId, webUrl }, "uploadInvoiceToSharePoint: invoice PDF uploaded to SharePoint");
  } catch (err) {
    logger.error({ err, invoiceId }, "uploadInvoiceToSharePoint: unexpected error");
  }
}
