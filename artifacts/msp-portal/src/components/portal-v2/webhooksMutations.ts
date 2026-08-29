/**
 * webhooksMutations.ts — the real write calls behind the Webhooks page's
 * Rotate secret / Edit / Delete buttons (Git #1605).
 *
 *   PATCH  /api/portal/webhooks/:webhookId                — edit (label/url/eventTypes/isActive)
 *   DELETE /api/portal/webhooks/:webhookId                — delete (hard; cascades delivery history)
 *   POST   /api/portal/webhooks/:webhookId/rotate-secret  — rotate (no grace period, old secret dies immediately)
 *
 * All three are already-live routes in `webhooks.ts` — see
 * `docs/webhooks-contract-pack.md` §2 for the extracted wire contract this
 * module was built against. Every function here returns a real, typed
 * `{ ok, ... }` result instead of throwing, using each route's own error
 * shape (`{ error: string }`) rather than a generic message, so the page can
 * show the real reason a mutation failed.
 *
 * `fetchWithAuth` is called with `{ silent: true }` on all three so its own
 * global failure-toast doesn't fire alongside this module's own inline error
 * surfacing on the page — the caller decides how to show the failure, not a
 * second, duplicate toast. Failures are still beaconed to the exception
 * tracker here, tagged with the locked `notification` channel (Git #1605's
 * own instruction — this module has no server-side `logger.child` of its
 * own to bind, so `reportClientEvent`'s `channel` argument is this frontend's
 * equivalent, per the precedent in `useMfaRegistrationLive.ts` /
 * `securityPlanLive.ts`).
 */

import { useCallback } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

const WEBHOOKS_URL = "/api/portal/webhooks";
const WEBHOOKS_CHANNEL = "notification";

export interface WebhookUpdateInput {
  label?: string;
  url?: string;
  eventTypes?: string[];
  isActive?: boolean;
}

export type WebhookMutationResult = { ok: true } | { ok: false; error: string };
export type WebhookRotateResult =
  | { ok: true; secret: string; secretPrefix: string }
  | { ok: false; error: string };

/** Reads `{ error: string }` off a non-OK response — the real shape every
 * `webhooks.ts` route returns on failure (400/403/404) — falling back to a
 * generic status-coded message only if the body isn't that shape. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export interface WebhookMutations {
  readonly updateWebhook: (webhookId: string, patch: WebhookUpdateInput) => Promise<WebhookMutationResult>;
  readonly deleteWebhook: (webhookId: string) => Promise<WebhookMutationResult>;
  readonly rotateSecret: (webhookId: string) => Promise<WebhookRotateResult>;
}

export function useWebhookMutations(): WebhookMutations {
  const { fetchWithAuth, accessToken } = useAuth();

  const updateWebhook = useCallback(
    async (webhookId: string, patch: WebhookUpdateInput): Promise<WebhookMutationResult> => {
      try {
        const res = await fetchWithAuth(
          `${WEBHOOKS_URL}/${webhookId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
          { silent: true },
        );
        if (!res.ok) {
          const error = await readError(res, `Could not update webhook (${res.status})`);
          reportClientEvent(accessToken, "WebhookUpdateFailed", error, WEBHOOKS_CHANNEL, {
            webhookId,
            status: res.status,
          });
          return { ok: false, error };
        }
        return { ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Could not update webhook";
        reportClientEvent(accessToken, "WebhookUpdateFailed", error, WEBHOOKS_CHANNEL, { webhookId });
        return { ok: false, error };
      }
    },
    [fetchWithAuth, accessToken],
  );

  const deleteWebhook = useCallback(
    async (webhookId: string): Promise<WebhookMutationResult> => {
      try {
        const res = await fetchWithAuth(`${WEBHOOKS_URL}/${webhookId}`, { method: "DELETE" }, { silent: true });
        if (!res.ok) {
          const error = await readError(res, `Could not delete webhook (${res.status})`);
          reportClientEvent(accessToken, "WebhookDeleteFailed", error, WEBHOOKS_CHANNEL, {
            webhookId,
            status: res.status,
          });
          return { ok: false, error };
        }
        return { ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Could not delete webhook";
        reportClientEvent(accessToken, "WebhookDeleteFailed", error, WEBHOOKS_CHANNEL, { webhookId });
        return { ok: false, error };
      }
    },
    [fetchWithAuth, accessToken],
  );

  const rotateSecret = useCallback(
    async (webhookId: string): Promise<WebhookRotateResult> => {
      try {
        const res = await fetchWithAuth(
          `${WEBHOOKS_URL}/${webhookId}/rotate-secret`,
          { method: "POST" },
          { silent: true },
        );
        if (!res.ok) {
          const error = await readError(res, `Could not rotate secret (${res.status})`);
          reportClientEvent(accessToken, "WebhookRotateSecretFailed", error, WEBHOOKS_CHANNEL, {
            webhookId,
            status: res.status,
          });
          return { ok: false, error };
        }
        const body = (await res.json()) as { secret: string; secretPrefix: string };
        return { ok: true, secret: body.secret, secretPrefix: body.secretPrefix };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Could not rotate secret";
        reportClientEvent(accessToken, "WebhookRotateSecretFailed", error, WEBHOOKS_CHANNEL, { webhookId });
        return { ok: false, error };
      }
    },
    [fetchWithAuth, accessToken],
  );

  return { updateWebhook, deleteWebhook, rotateSecret };
}
