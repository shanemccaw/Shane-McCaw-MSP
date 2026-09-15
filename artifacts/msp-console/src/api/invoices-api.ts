/**
 * invoices-api.ts — the data seam for the MSP Console's Invoices tab (Git
 * #4109, wiring done by #2609), wiring the real route surface in
 * `artifacts/api-server/src/routes/msp-invoices.ts`:
 *
 *   GET    /api/msp/:mspId/clients                    (added by #2609 — the billed-party picker)
 *   GET    /api/msp/:mspId/invoices
 *   GET    /api/msp/:mspId/invoices/:id
 *   POST   /api/msp/:mspId/invoices
 *   PATCH  /api/msp/:mspId/invoices/:id
 *   DELETE /api/msp/:mspId/invoices/:id
 *   POST   /api/msp/:mspId/invoices/:id/revise
 *
 * Invoices are billed to `usersTable` rows (the legacy client-portal-user
 * axis `invoicesTable.clientUserId` points at) — a structurally different
 * concept from `tenantsTable` (the axis Seat Pricing / Retainer Switch /
 * Subscription are all scoped to). There is no FK between the two tables, so
 * this module carries its own client picker rather than inheriting the
 * currently-selected tenant — see `msp-invoices.ts`'s own header.
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type InvoiceStatus = "draft" | "due" | "paid" | "overdue" | "superseded";
export type InvoiceType = "instant" | "retainer";

export interface MspClient {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
}

export interface Invoice {
  id: number;
  clientUserId: number;
  projectId: number | null;
  invoiceNumber: string;
  description: string | null;
  amount: string; // dollar-string wire contract (Git #1610)
  currency: string;
  status: InvoiceStatus;
  dueDate: string | null;
  paidAt: string | null;
  invoiceType: InvoiceType;
  couponCode: string | null;
  discountAmount: string | null;
  version: number;
  supersedesInvoiceId: number | null;
  revisionReason: string | null;
  createdAt: string;
  updatedAt: string;
  clientName?: string;
  clientEmail?: string;
}

export interface CreateInvoiceInput {
  clientUserId: number;
  projectId?: number | null;
  invoiceNumber: string;
  description?: string | null;
  amount: number;
  currency?: string;
  dueDate?: string | null;
  invoiceType?: InvoiceType;
}

export interface UpdateInvoiceInput {
  invoiceNumber?: string;
  description?: string | null;
  amount?: number;
  dueDate?: string | null;
  status?: "draft" | "due" | "paid" | "overdue";
}

export interface ReviseInvoiceInput {
  reason: string;
  amount?: number;
  description?: string | null;
  dueDate?: string | null;
}

export class InvoicesApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function requestJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithAuth(url, init);
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error.length > 0) message = body.error;
    } catch { /* body wasn't JSON — keep the generic message */ }
    throw new InvoicesApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const clientsKey = (mspId: number) => ["msp", mspId, "clients"];
const invoicesKey = (mspId: number, clientUserId: number | null) => ["msp", mspId, "invoices", clientUserId];

export function useMspClients(mspId: number): UseQueryResult<MspClient[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: clientsKey(mspId),
    queryFn: () => requestJson<MspClient[]>(fetchWithAuth, `/api/msp/${mspId}/clients`),
    enabled: !isLoading && !!accessToken && Number.isFinite(mspId),
    staleTime: 30_000,
  });
}

export function useInvoices(mspId: number, clientUserId: number | null): UseQueryResult<Invoice[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: invoicesKey(mspId, clientUserId),
    queryFn: () =>
      requestJson<Invoice[]>(fetchWithAuth, `/api/msp/${mspId}/invoices?clientUserId=${clientUserId}`),
    enabled: !isLoading && !!accessToken && Number.isFinite(mspId) && clientUserId != null,
    staleTime: 5_000,
  });
}

export function useCreateInvoice(mspId: number, clientUserId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) =>
      requestJson<Invoice>(fetchWithAuth, `/api/msp/${mspId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invoicesKey(mspId, clientUserId) }),
  });
}

export function useUpdateInvoice(mspId: number, clientUserId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateInvoiceInput }) =>
      requestJson<Invoice>(fetchWithAuth, `/api/msp/${mspId}/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invoicesKey(mspId, clientUserId) }),
  });
}

export function useDeleteInvoice(mspId: number, clientUserId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      requestJson<void>(fetchWithAuth, `/api/msp/${mspId}/invoices/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invoicesKey(mspId, clientUserId) }),
  });
}

export function useReviseInvoice(mspId: number, clientUserId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: ReviseInvoiceInput }) =>
      requestJson<{ superseded: Invoice; revised: Invoice }>(fetchWithAuth, `/api/msp/${mspId}/invoices/${id}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invoicesKey(mspId, clientUserId) }),
  });
}
