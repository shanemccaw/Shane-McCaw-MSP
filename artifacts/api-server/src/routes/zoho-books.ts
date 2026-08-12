// Zoho Books Admin read route (#881).
//
//   GET /api/zoho/books/invoices/lookup/by-reference?reference=… — invoice-by-reference lookup
//
// Zoho Books (#87) is otherwise one-way outbound sync with no in-platform read
// route at all — every node there enqueues a write and nothing is ever read
// back. This is the one exception: a single admin read endpoint that mirrors
// the CRM lookup-by-email pattern (zoho-crm.ts) so Git #881's zohoTests can
// assert "invoice found / not-found" the same expect{}-shaped way apiTests do.
//
// It does NOT reimplement the reference-number query — it calls
// lookupBooksInvoiceByReference in lib/zoho-books.ts, which reuses the exact
// findBooksInvoiceByReference idempotency guard createBooksInvoice already
// relies on, so the read path asks Zoho the identical question the write path
// asks. Read-only: no write, no queue, no side effects.

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAuth";
import { lookupBooksInvoiceByReference } from "../lib/zoho-books.ts";
import { ZohoNotConnectedError, ZohoApiError } from "../lib/zoho-client.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.zoho" });

const router: IRouter = Router();

/**
 * Same honest error mapping zoho-crm.ts uses: a missing OAuth connection is a
 * 503 with an actionable code, a Zoho 4xx passes its own status through, and
 * anything else is a 500 — never a silent crash.
 */
function handleZohoError(err: unknown, res: Response, context: string): void {
  if (err instanceof ZohoNotConnectedError) {
    log.warn({ context }, "zoho-books route: Zoho not connected");
    res.status(503).json({ error: err.message, code: "zoho_not_connected" });
    return;
  }
  if (err instanceof ZohoApiError) {
    log.warn({ context, status: err.status }, "zoho-books route: Zoho API error");
    res.status(err.status >= 400 && err.status < 500 ? err.status : 502).json({
      error: `Zoho API error (${err.status})`,
      code: "zoho_api_error",
      details: err.body,
    });
    return;
  }
  log.error({ err, context }, "zoho-books route: unexpected failure");
  res.status(500).json({ error: "Unexpected failure talking to Zoho Books" });
}

/**
 * Invoice-by-reference lookup backing Git #881's zohoTests. Returns
 * { found, invoiceId, referenceNumber } — the shape the manifest asserts
 * against with a { jsonPath: "$.found", value: true|false } expectation.
 */
router.get("/zoho/books/invoices/lookup/by-reference", requireAdmin, async (req: Request, res: Response) => {
  const reference = String(req.query.reference ?? "").trim();
  if (!reference) {
    res.status(400).json({ error: "reference query parameter is required" });
    return;
  }

  try {
    const invoiceId = await lookupBooksInvoiceByReference(reference);
    log.info({ reference, found: Boolean(invoiceId) }, "zoho-books route: invoice lookup by reference");
    res.json({ found: Boolean(invoiceId), invoiceId: invoiceId ?? null, referenceNumber: reference });
  } catch (err) {
    handleZohoError(err, res, "lookup Books invoice by reference");
  }
});

export default router;
