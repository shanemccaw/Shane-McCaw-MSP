/**
 * azure-credential-api.ts — the data seam for the MSP Console's Azure
 * Credential module page (#3968, Feature #3966), wiring the real
 * MSP-operator routes landed by #3967 in
 * `artifacts/api-server/src/routes/msp-azure-credentials.ts`:
 *
 *   GET    /msp/:mspId/clients/:clientUserId/azure-credential
 *   POST   /msp/:mspId/clients/:clientUserId/azure-credential   — upsert
 *   PUT    /msp/:mspId/clients/:clientUserId/azure-credential   — update in place
 *   DELETE /msp/:mspId/clients/:clientUserId/azure-credential
 *
 * These routes key on `clientUserId` (a `users.id`), not on the MSP Console's
 * own tenant/customer id (`tenantsTable.id`) that every other per-tenant
 * module here takes — `#3967`'s own header explains why: the credential
 * belongs to the customer ACCOUNT, and a customer can have several logins
 * (`usersTable.tenantId` siblings) any one of which might carry the row.
 * `portal-azure-credential.ts` (the customer's own self-service view of the
 * same table) resolves this by reading across every sibling login
 * (`resolveSiblingUserIds`); the MSP-operator routes landed by #3967 do not —
 * they take one `clientUserId` directly and filter it only by
 * `users.msp_id`, with no tenant-sibling resolution of their own.
 *
 * This console has no route to ask the server for "the" canonical client user
 * for a tenant, so `useResolvedClientUserId` below picks one client-side from
 * the tenant's own team roster (`team-api.ts`'s `useTeamRoster`, the same
 * `usersTable.tenantId = customerId` read every other per-tenant module already
 * uses) — the active member with the earliest `createdAt`, falling back to the
 * lowest id among an all-suspended roster. This mirrors the server's own
 * `canonicalPortalUserOrder()` (`tenant-signals.ts`) as closely as the roster
 * response allows; the one piece that resolver has and this roster response
 * does not is the `Customer`/`Free`/other `mspRole` tie-break, which
 * `team-api.ts`'s `TeamMember` does not carry. In practice a tenant's roster is
 * client accounts, so this is not expected to matter, but it is an honest,
 * client-side best-effort, not the server's own resolution.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamRoster } from "./team-api";

export type AzureCredentialType = "secret" | "certificate";

export interface AzureCredential {
  readonly id: number;
  readonly clientUserId: number | null;
  readonly displayName: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly credentialType: AzureCredentialType;
  readonly keyVaultSecretName: string;
  readonly lastExpiryAlertSentAt: string | null;
  readonly expiresOn: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AzureCredentialInput {
  readonly displayName: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly credentialType: AzureCredentialType;
  /** A new raw secret value to rotate in. Omit to leave the stored secret untouched. */
  readonly clientSecretValue?: string;
}

/** A fetch that failed reports its real HTTP status — same pattern as `TeamApiError`/`BreakGlassApiError`. */
export class AzureCredentialApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new AzureCredentialApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/**
 * The tenant's canonical client user, resolved client-side from its team
 * roster — see this file's header for why no server route resolves this
 * directly for the MSP-operator surface. `null` while the roster is loading
 * or when the tenant has no team member at all (an unclaimed customer).
 */
export function useResolvedClientUserId(customerId: number): { clientUserId: number | null; isLoading: boolean; isError: boolean } {
  const rosterQuery = useTeamRoster(customerId);
  const clientUserId = useMemo(() => {
    const rows = rosterQuery.data ?? [];
    if (rows.length === 0) return null;
    const active = rows.filter((r) => r.isActive);
    const pool = active.length > 0 ? active : rows;
    const sorted = [...pool].sort((a, b) => {
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      if (at !== bt) return at - bt;
      return a.userId - b.userId;
    });
    return sorted[0]?.userId ?? null;
  }, [rosterQuery.data]);

  return { clientUserId, isLoading: rosterQuery.isLoading, isError: rosterQuery.isError };
}

const credentialKey = (mspId: number, clientUserId: number) => ["msp", "azure-credential", mspId, clientUserId] as const;

export function useAzureCredential(mspId: number | null, clientUserId: number | null): UseQueryResult<AzureCredential | null, AzureCredentialApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: credentialKey(mspId ?? -1, clientUserId ?? -1),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/${mspId}/clients/${clientUserId}/azure-credential`);
      return parseJsonOrThrow<AzureCredential | null>(res);
    },
    enabled: !isLoading && !!accessToken && mspId != null && clientUserId != null,
    staleTime: 15_000,
  });
}

/** Upsert (`POST`) — creates when none exists yet, or updates the existing row in place. */
export function useUpsertAzureCredential(mspId: number | null, clientUserId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AzureCredentialInput) => {
      const res = await fetchWithAuth(`/api/msp/${mspId}/clients/${clientUserId}/azure-credential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<AzureCredential>(res);
    },
    onSuccess: () => {
      if (mspId != null && clientUserId != null) {
        void queryClient.invalidateQueries({ queryKey: credentialKey(mspId, clientUserId) });
      }
    },
  });
}

export function useDeleteAzureCredential(mspId: number | null, clientUserId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/msp/${mspId}/clients/${clientUserId}/azure-credential`, { method: "DELETE" });
      return parseJsonOrThrow<{ ok: true }>(res);
    },
    onSuccess: () => {
      if (mspId != null && clientUserId != null) {
        void queryClient.invalidateQueries({ queryKey: credentialKey(mspId, clientUserId) });
      }
    },
  });
}
