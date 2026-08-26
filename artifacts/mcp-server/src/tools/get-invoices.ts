import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * get_invoices — the platform's own invoice records (admin-invoices.ts's real
 * GET /admin/invoices), filterable by type/status, with client name attached.
 *
 * Honest Zoho-Books reporting (per #1322): the invoices returned here are the
 * platform's OWN records (Stripe / onboarding invoices) — NOT a mirror of Zoho
 * Books. Zoho Books integration (#87) is deliberately OUTBOUND-ONLY: the
 * platform pushes financial facts to Books; it never reads invoices back, and
 * there is no in-platform read of Books data anywhere. So this tool explicitly
 * annotates the Zoho connection status (from GET /zoho/auth/status) and states
 * that these invoices are not sourced from Books — rather than presenting them
 * as a live Books figure.
 */

const inputSchema = {
  type: z.enum(["all", "instant", "retainer"]).optional().describe("Filter by invoice type. Default all."),
  status: z.enum(["all", "draft", "due", "paid", "overdue"]).optional().describe("Filter by status. Default all."),
};

interface InvoiceRow {
  id: number;
  invoiceNumber?: string;
  amount?: string;
  currency?: string;
  status?: string;
  invoiceType?: string;
  dueDate?: string | null;
  paidAt?: string | null;
  stripeInvoiceId?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientCompany?: string | null;
  createdAt?: string;
  [k: string]: unknown;
}

interface ZohoStatus {
  credentialsConfigured?: boolean;
  connection?: { status?: string; zohoOrgId?: string | null; connectedAt?: string | null; lastErrorMessage?: string | null };
}

export const getInvoicesTool: ToolDef = {
  name: "get_invoices",
  description:
    "The platform's invoice records (GET /admin/invoices), filterable by type (instant/retainer) and status " +
    "(draft/due/paid/overdue), with client name/company. IMPORTANT: these are the platform's own Stripe/onboarding " +
    "invoices, NOT a Zoho Books mirror — Zoho Books (#87) is outbound-only and is never read back into the platform. " +
    "The response includes an explicit zohoBooksSync block reporting that, plus the live Zoho connection status.",
  inputSchema,
  handler: async (args) => {
    const type = (args.type as string) ?? "all";
    const status = (args.status as string) ?? "all";

    const rows = await apiFetch<InvoiceRow[]>("/admin/invoices", {
      query: { type: type === "all" ? undefined : type, status: status === "all" ? undefined : status },
    });
    const list = Array.isArray(rows) ? rows : [];

    // Best-effort Zoho connection status; never let it fail the invoice read.
    let zoho: ZohoStatus | null = null;
    let zohoError: string | null = null;
    try {
      zoho = await apiFetch<ZohoStatus>("/zoho/auth/status");
    } catch (err) {
      zohoError = err instanceof Error ? err.message : String(err);
    }

    const totalsByStatus: Record<string, { count: number; amount: number }> = {};
    for (const inv of list) {
      const s = inv.status ?? "unknown";
      const amt = Number(inv.amount ?? 0) || 0;
      totalsByStatus[s] = totalsByStatus[s] ?? { count: 0, amount: 0 };
      totalsByStatus[s].count += 1;
      totalsByStatus[s].amount += amt;
    }

    return {
      count: list.length,
      filters: { type, status },
      totalsByStatus,
      source: "platform invoices table (Stripe / onboarding invoices) — GET /admin/invoices",
      zohoBooksSync: {
        // The load-bearing honesty: these figures are NOT a Zoho Books sync.
        booksSyncPopulatesTheseInvoices: false,
        note:
          "Zoho Books integration (#87) is OUTBOUND-ONLY: the platform pushes financial facts to Books and never " +
          "reads them back — there is no in-platform read of Zoho Books data. The invoices above are the platform's " +
          "own records, not a Books mirror, and should not be treated as a live Zoho Books figure.",
        zohoConnection: zoho
          ? {
              credentialsConfigured: zoho.credentialsConfigured ?? false,
              status: zoho.connection?.status ?? "unknown",
              zohoOrgId: zoho.connection?.zohoOrgId ?? null,
              connectedAt: zoho.connection?.connectedAt ?? null,
              lastErrorMessage: zoho.connection?.lastErrorMessage ?? null,
            }
          : { unavailable: true, error: zohoError },
      },
      invoices: list.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: inv.amount,
        currency: inv.currency,
        status: inv.status,
        invoiceType: inv.invoiceType,
        dueDate: inv.dueDate ?? null,
        paidAt: inv.paidAt ?? null,
        stripeInvoiceId: inv.stripeInvoiceId ?? null,
        client: { name: inv.clientName ?? null, email: inv.clientEmail ?? null, company: inv.clientCompany ?? null },
        createdAt: inv.createdAt,
      })),
    };
  },
};
