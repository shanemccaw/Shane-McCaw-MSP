/**
 * team-api.ts — the data seam for the MSP Console's Team module page
 * (Git #2640, Feature #2567). Mounts at `/tenants/:id/team`
 * (`Design/MSP_Console/design_handoff_msp_console/Team.dc.html`, README
 * screen 17), wiring the real, previously-orphaned operator backend
 * documented in full at
 * `docs/msp-console/team-management-and-invitations-msp-console-contract-pack.md`:
 *
 *   GET    /api/msp/customers/:customerId/team               — roster for one customer
 *   POST   /api/msp/customers/:customerId/team/invite         — invite a teammate
 *   DELETE /api/msp/team/:userId/sessions                     — revoke all of the target's sessions
 *   PATCH  /api/msp/team/:userId/status                       — activate/suspend
 *   PATCH  /api/msp/team/:userId/mfa-enforcement              — toggle MFA enforcement
 *   POST   /api/msp/team/:userId/unlock                       — clear lockout state
 *   POST   /api/msp/team/:userId/reset-password                — email a reset link
 *   POST   /api/msp/team/:userId/temp-password                 — mint + return a temp password
 *   POST   /api/msp/team/:userId/reset-mfa                      — full MFA teardown
 *   POST   /api/msp/team/:userId/emergency-bypass               — mint a 24h MFA bypass code
 *
 * Real, honest departures from the design's fixture-driven mock (contract pack
 * §1, §4):
 *   - There is no `role`/`jobTitle`+`department` distinction the design implies
 *     with its "PERSON / ROLE" column split — the real roster row carries
 *     `jobTitle` and `department` as free-text fields, and every invited
 *     teammate is written with the flat `mspRole: "CustomerUser"` (contract
 *     pack §2). There is no invite-time way to grant a different role, and no
 *     "role" facet to filter or display beyond that. This seam does not
 *     invent one.
 *   - The roster has no per-row "locked" boolean the design's fixture
 *     hardcodes — `isLockedOut` is derived server-side from `lockedUntil`.
 *   - `mfaStatus` is one of exactly `"TOTP" | "FIDO2" | "SMS" | "Disabled"`
 *     (`reduceMfaStatus()`), not the design's free-text label.
 *   - The roster has no server-side sort or pagination (contract pack §1) —
 *     rows render in whatever order the backend returns them.
 *   - Error responses from the 8 `.../team/:userId/...` mutating routes are
 *     bare-string (`{ error: string }`), not the nested `apiError()` envelope
 *     the two `.../team[/invite]` routes use (contract pack §0.3) — this seam
 *     reads `.error` as a string from either shape rather than assuming one.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type MfaStatus = "TOTP" | "FIDO2" | "SMS" | "Disabled";

export interface TeamMember {
  readonly id: number;
  readonly userId: number;
  readonly email: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly isActive: boolean;
  readonly isLockedOut: boolean;
  readonly mfaStatus: MfaStatus;
  readonly mfaEnforced: boolean;
  readonly department: string;
  readonly jobTitle: string;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly activeSessionsCount: number;
}

export interface InviteTeammateInput {
  readonly email: string;
  readonly name?: string;
  readonly department?: string;
  readonly jobTitle?: string;
}

/** A fetch that failed reports its real HTTP status so the page can tell
 * "not in this MSP's book" (403) apart from a generic failure — same pattern
 * as `break-glass-api.ts`'s `BreakGlassApiError` / `data-rights-api.ts`'s
 * `DataRightsApiError`. */
export class TeamApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Both error-envelope shapes this router answers with (contract pack §0.3):
 * bare-string `{ error: string }` on 8 of the 10 routes, or the nested
 * `apiError()` nested `{ error: { message: string } }` on the other 2. */
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
    throw new TeamApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const rosterKey = (customerId: number) => ["msp", "team", "customers", customerId] as const;

export function useTeamRoster(customerId: number): UseQueryResult<TeamMember[], TeamApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: rosterKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/team`);
      return parseJsonOrThrow<TeamMember[]>(res);
    },
    enabled: !isLoading && !!accessToken && Number.isInteger(customerId),
    staleTime: 15_000,
  });
}

export function useInviteTeammate(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: InviteTeammateInput) => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/team/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<{ ok: true }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: rosterKey(customerId) }),
  });
}

/**
 * The eight per-member mutating routes, each keyed off `userId` rather than
 * `customerId` (contract pack §0.2 / §4) — grouped here into one hook per
 * shell so the module doesn't hand-roll eight near-identical `useMutation`
 * calls. `customerId` is only used to invalidate the right roster query on
 * success; it is never sent on the wire for these routes.
 */
export function useSetMemberStatus(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, isActive }: { userId: number; isActive: boolean }) => {
      const res = await fetchWithAuth(`/api/msp/team/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      return parseJsonOrThrow<{ ok: true; isActive: boolean }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: rosterKey(customerId) }),
  });
}

export function useSetMfaEnforcement(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, enforced }: { userId: number; enforced: boolean }) => {
      const res = await fetchWithAuth(`/api/msp/team/${userId}/mfa-enforcement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforced }),
      });
      return parseJsonOrThrow<{ ok: true; mfaEnforced: boolean }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: rosterKey(customerId) }),
  });
}

export function useUnlockMember(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/team/${userId}/unlock`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true; isLockedOut: false }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: rosterKey(customerId) }),
  });
}

export function useSendPasswordReset() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/team/${userId}/reset-password`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true }>(res);
    },
  });
}

export function useSetTempPassword() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/team/${userId}/temp-password`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true; tempPassword: string }>(res);
    },
  });
}

export function useResetMfa(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/team/${userId}/reset-mfa`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true; clearedMethods: string[] }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: rosterKey(customerId) }),
  });
}

export function useSignOutSessions(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/team/${userId}/sessions`, { method: "DELETE" });
      return parseJsonOrThrow<{ ok: true; revokedCount: number }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: rosterKey(customerId) }),
  });
}

export function useGenerateEmergencyBypass() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/team/${userId}/emergency-bypass`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true; bypassCode: string; expiresAt: string }>(res);
    },
  });
}
