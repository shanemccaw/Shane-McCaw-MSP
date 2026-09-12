/**
 * MSP Console — Outbound Webhooks module (Git #2612, Feature #1693). Mounts
 * into the shell's `ScreenSlot` at `/tenants/:id/wh`
 * (`Design/MSP_Console/design_handoff_msp_console/Webhooks.dc.html`, README
 * screen 20). Wired against the real, already-built operator backend
 * (`artifacts/api-server/src/routes/msp-console-webhooks.ts`, #2704):
 *
 *   GET  /api/msp/customers/:customerId/webhooks
 *   GET  /api/msp/customers/:customerId/webhooks/:webhookId/deliveries?limit=N
 *   POST /api/msp/customers/:customerId/webhooks/:webhookId/disable
 *   POST /api/msp/customers/:customerId/webhooks/:webhookId/enable
 *
 * Deliberately not wired here: the design's third "What comes in to us" tab
 * (inbound platform webhooks — Stripe, internal service callbacks). That is
 * not this backend's scope at all (#2704's own doc comment: this module is
 * the operator half of *customer-configured* outbound endpoints only) and the
 * design's own copy for it doesn't hold up against the real inbound Stripe
 * handler's current behaviour — see the finding filed alongside this build.
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface ConsoleWebhook {
  webhookId: string;
  label: string;
  url: string;
  secretPrefix: string;
  eventTypes: string[];
  isActive: boolean;
  ownerType: "msp" | "customer" | "platform";
  mspId: number | null;
  customerId: number | null;
  disabledByMspUserId: number | null;
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
  unrecognizedEventTypes: string[];
  disabledByName: string | null;
}

export interface WebhookDelivery {
  deliveryId: string;
  webhookId: string;
  eventId: string | null;
  eventType: string;
  attempt: number;
  status: string;
  statusCode: number | null;
  responseSnippet: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface DeliveriesResponse {
  deliveries: WebhookDelivery[];
  nextCursor: number | null;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

const base = (customerId: number) => `/api/msp/customers/${customerId}`;
const webhooksKey = (customerId: number) => ["msp", "console-webhooks", customerId] as const;
const deliveriesKey = (customerId: number, webhookId: string) =>
  ["msp", "console-webhooks", customerId, webhookId, "deliveries"] as const;

// ── Customer endpoints ──────────────────────────────────────────────────────

export function useCustomerWebhooks(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: webhooksKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/webhooks`);
      return parseJsonOrThrow<{ webhooks: ConsoleWebhook[] }>(res);
    },
  });
}

export function useWebhookDeliveries(customerId: number, webhookId: string | null, limit = 50) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: deliveriesKey(customerId, webhookId ?? ""),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/webhooks/${encodeURIComponent(webhookId!)}/deliveries?limit=${limit}`);
      return parseJsonOrThrow<DeliveriesResponse>(res);
    },
    enabled: webhookId != null,
  });
}

/**
 * The design's combined "Deliveries" tab spans every endpoint at once. The
 * real backend only serves a delivery log per-webhook, so this fans out one
 * request per known webhook id and merges — honest for the handful of
 * endpoints a single customer registers, not a scalability concern here.
 */
export function useAllCustomerDeliveries(customerId: number, webhookIds: string[], limitEach = 25) {
  const { fetchWithAuth } = useAuth();
  const results = useQueries({
    queries: webhookIds.map((webhookId) => ({
      queryKey: deliveriesKey(customerId, webhookId),
      queryFn: async () => {
        const res = await fetchWithAuth(`${base(customerId)}/webhooks/${encodeURIComponent(webhookId)}/deliveries?limit=${limitEach}`);
        const body = await parseJsonOrThrow<DeliveriesResponse>(res);
        return body.deliveries.map((d) => ({ ...d, webhookId }));
      },
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const isError = results.some((r) => r.isError);
  const deliveries = results.flatMap((r) => r.data ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { deliveries, isLoading, isError };
}

// ── Reversible disable / enable ──────────────────────────────────────────────

export function useDisableWebhook(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ webhookId, reason }: { webhookId: string; reason?: string }) => {
      const res = await fetchWithAuth(`${base(customerId)}/webhooks/${encodeURIComponent(webhookId)}/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      return parseJsonOrThrow<{ webhook: ConsoleWebhook | null }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: webhooksKey(customerId) }),
  });
}

export function useEnableWebhook(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (webhookId: string) => {
      const res = await fetchWithAuth(`${base(customerId)}/webhooks/${encodeURIComponent(webhookId)}/enable`, {
        method: "POST",
      });
      return parseJsonOrThrow<{ webhook: ConsoleWebhook | null }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: webhooksKey(customerId) }),
  });
}
