/**
 * staff-roster-api.ts — the data seam for the MSP Console's Staff Roster
 * module page (#2662, Feature #2574). Mounts at `/ops/staff`
 * (`Design/MSP_Console/design_handoff_msp_console/Staff Roster.dc.html`,
 * README screen 65), wiring the real nineteen-route surface documented in
 * full at `docs/msp-console/msp-staff-roles-and-onboarding-contract-pack.md`:
 *
 *   GET    /api/msp/settings/users                                — the roster (shared with Account Security)
 *   GET    /api/msp/settings/users/:userId/customer-scopes
 *   PUT    /api/msp/settings/users/:userId/customer-scopes
 *   PATCH  /api/msp/settings/users/:userId/role
 *   PATCH  /api/msp/settings/users/:userId/approve-purchases
 *   DELETE /api/msp/settings/users/:userId                          — soft remove from the MSP
 *   GET    /api/msp/settings/sessions                               — MSP-wide (shared with Account Security)
 *   DELETE /api/msp/settings/users/:userId/sessions                 — shared with Account Security
 *   PATCH  /api/msp/settings/users/:userId/status                   — shared with Account Security
 *   GET    /api/msp/settings/invites
 *   POST   /api/msp/settings/invites
 *   DELETE /api/msp/settings/invites/:inviteId
 *
 * The roster, MSP-wide sessions, per-user session revoke, and suspend/
 * reactivate status routes are the exact same six-route surface
 * `account-security-api.ts` already wires (its own header: "shared verbatim
 * with the MSP Staff roster feature. A fix to one changes both.") — this
 * file re-exports those hooks rather than re-querying the same routes under
 * a second cache key.
 *
 * Real, honest departures from the design's fixture-driven mock (contract
 * pack §1-§6):
 *   - The roster route applies no role filter of its own (§1) — the
 *     "Staff only / Everyone with this MSP id" switch and both counts are
 *     drawn client-side here, exactly as the design specifies.
 *   - `assignedCustomersCount === 0` means unrestricted (the whole book),
 *     never "no access" (§1) — rendered as "All customers", never an empty
 *     badge.
 *   - Only `MSPAdmin`/`MSPOperator` can ever be set via role/invite (§3,
 *     §5c, §6) — enforced server-side by Zod; this page never offers a
 *     third choice.
 *   - Saving customer scopes is a full replace in one transaction (§2) — an
 *     empty save is valid and clears the person back to unrestricted.
 *   - Self-targeting is refused at the server for suspend/reactivate,
 *     remove and (implicitly, this page's own guard) role/scope changes on
 *     your own account are still permitted by the routes but nonsensical in
 *     the UI — suspend/remove show the server's real 400 rather than a
 *     client-side guess.
 *   - There is no per-person session GET (§0.9 / §5a) — "their sessions" is
 *     the MSP-wide list filtered client-side by `userId`, same pattern
 *     `account-security-api.ts` already uses.
 *   - An invite create/list/revoke never fabricates a row — §5c's 201
 *     response (including the raw token) is shown once, verbatim.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  AccountSecurityApiError,
  useAccountRoster,
  useMspSessions,
  useRevokeAccountSessions,
  useSetAccountStatus,
  type AccountSecurityRole,
  type AccountSecurityUser,
  type MspSession,
} from "./account-security-api";

export {
  AccountSecurityApiError as StaffRosterApiError,
  useAccountRoster as useStaffRoster,
  useMspSessions,
  useRevokeAccountSessions,
  useSetAccountStatus,
};
export type StaffRole = AccountSecurityRole;
export type StaffMember = AccountSecurityUser;
export type { MspSession };

/** `updateRoleSchema` / `createInviteSchema` (`msp-settings.ts`) — the only
 * two roles this surface's routes ever accept. */
export const ASSIGNABLE_ROLES = ["MSPAdmin", "MSPOperator"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** `STAFF_ROLES` in the design's own logic class — used client-side only,
 * since the roster route itself applies no role filter (§1, §8.2). */
export const STAFF_ROLES: ReadonlySet<StaffRole> = new Set(ASSIGNABLE_ROLES);

export interface CustomerScope {
  readonly id: number;
  readonly name: string;
  readonly status: string;
}

export interface CustomerScopesResponse {
  readonly mspRole: StaffRole | null;
  readonly scopable: boolean;
  readonly allCustomers: CustomerScope[];
  readonly assignedCustomerIds: number[];
}

export interface MspInvite {
  readonly id: number;
  readonly invitedEmail: string;
  readonly mspRole: AssignableRole;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly inviterEmail: string | null;
  readonly inviterName: string | null;
  /** Present only on the create response (§5c) — shown once, never persisted. */
  readonly token?: string;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string | { message?: string } };
      if (typeof body?.error === "string") message = body.error;
      else if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new AccountSecurityApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const rosterKey = ["msp", "account-security", "roster"] as const;
const sessionsKey = ["msp", "account-security", "sessions"] as const;
const scopesKey = (userId: number) => ["msp", "staff-roster", "scopes", userId] as const;
const invitesKey = ["msp", "staff-roster", "invites"] as const;

function invalidateRoster(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: rosterKey });
}

export function useCustomerScopes(userId: number | null): UseQueryResult<CustomerScopesResponse, AccountSecurityApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: scopesKey(userId ?? -1),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/customer-scopes`);
      return parseJsonOrThrow<CustomerScopesResponse>(res);
    },
    enabled: !isLoading && !!accessToken && userId != null,
    staleTime: 15_000,
  });
}

export function useSetCustomerScopes() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, customerIds }: { userId: number; customerIds: number[] }) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/customer-scopes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerIds }),
      });
      return parseJsonOrThrow<{ ok: true; assignedCustomerIds: number[]; unrestricted: boolean }>(res);
    },
    onSuccess: (_data, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: scopesKey(userId) });
      invalidateRoster(queryClient);
    },
  });
}

export function useSetStaffRole() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, mspRole }: { userId: number; mspRole: AssignableRole }) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mspRole }),
      });
      return parseJsonOrThrow<{ ok: true }>(res);
    },
    onSuccess: (_data, { userId }) => {
      invalidateRoster(queryClient);
      void queryClient.invalidateQueries({ queryKey: scopesKey(userId) });
    },
  });
}

export function useSetApprovePurchases() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, canApprovePurchases }: { userId: number; canApprovePurchases: boolean }) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/approve-purchases`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canApprovePurchases }),
      });
      return parseJsonOrThrow<{ ok: true }>(res);
    },
    onSuccess: () => invalidateRoster(queryClient),
  });
}

export function useRemoveStaffMember() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}`, { method: "DELETE" });
      return parseJsonOrThrow<{ ok: true }>(res);
    },
    onSuccess: () => invalidateRoster(queryClient),
  });
}

export function useInvites(): UseQueryResult<MspInvite[], AccountSecurityApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: invitesKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/settings/invites");
      return parseJsonOrThrow<MspInvite[]>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

export function useSendInvite() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, mspRole }: { email: string; mspRole: AssignableRole }) => {
      const res = await fetchWithAuth("/api/msp/settings/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, mspRole }),
      });
      return parseJsonOrThrow<MspInvite>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invitesKey }),
  });
}

export function useRevokeInvite() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: number) => {
      const res = await fetchWithAuth(`/api/msp/settings/invites/${inviteId}`, { method: "DELETE" });
      return parseJsonOrThrow<unknown>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invitesKey }),
  });
}
