/**
 * account-security-api.ts — the data seam for the MSP Console's Account
 * Security module page (Git #2624, Feature #2562). Mounts at `/ops/acctsec`
 * (`Design/MSP_Console/design_handoff_msp_console/Account Security.dc.html`,
 * README screen 39), wiring the real six-route surface documented in full at
 * `docs/msp-console/account-security-msp-console-contract-pack.md`:
 *
 *   GET    /api/msp/settings/users                      — the reachable roster
 *   POST   /api/msp/settings/users/:userId/reset-password
 *   POST   /api/msp/settings/users/:userId/temp-password
 *   POST   /api/msp/settings/users/:userId/reset-mfa
 *   PATCH  /api/msp/settings/users/:userId/mfa-enforcement
 *   PATCH  /api/msp/settings/users/:userId/status
 *   DELETE /api/msp/settings/users/:userId/sessions
 *   GET    /api/msp/settings/sessions                    — MSP-wide live session list
 *   GET    /api/msp/audit?entityType=msp_user&entityId=  — this account's real audit history
 *
 * Real, honest departures from the design's fixture-driven mock (contract pack §0.1-§4):
 *   - **The target-role ceiling is now server-enforced, not a UI-only guard.**
 *     The design's own copy ("The target-role ceiling is enforced by this
 *     screen only") described the state before #3032 landed (commit
 *     `fcb16b522`, 2026-09-06) — all six of these routes now really 403 a
 *     caller acting on an equal-or-higher-privileged target
 *     (`rejectIfTargetOutranksCaller` in `msp-settings.ts`; the sessions route
 *     was the one route #3032 missed, closed separately as #3896 in this same
 *     build). This seam surfaces that 403 as the real "blocked" state — it
 *     does not compute a client-side role-order guess to fake the same effect.
 *   - The roster is every row carrying this MSP's real `mspId`, not a
 *     tenant-scoped "our customers" list — no route resolves a target by
 *     `tenantId` for any of these six actions (contract pack §0, §4.2). A row
 *     that also carries a real `tenantId` is flagged as a real customer user
 *     caught by the pre-`users`-merge `mspId` leftover, not invented — the
 *     `tenantId` value itself comes straight off the roster response.
 *   - "Their sessions" is the real MSP-wide session list
 *     (`GET /msp/settings/sessions`) filtered client-side to the selected
 *     `userId` — there is no per-user sessions route. It carries real
 *     `userAgent`/`ipAddress`/`issuedAt`, not the design's fabricated "totp /
 *     passkey / password" per-session auth method, which nothing on the wire
 *     tracks.
 *   - "Audit trail" reads real, persisted `msp_audit_logs` rows for this
 *     target (`entityType=msp_user&entityId=<id>`, extended onto
 *     `GET /msp/audit` in this same build) — not the design's ephemeral,
 *     session-only log built purely from local action responses.
 *   - `mfaEnforced` and `tenantId` were not previously returned by the roster
 *     route; both were added to its response in this build (real columns,
 *     no schema change) because this screen is the first caller that needs
 *     them.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

/** `MSP_ROLES` (`lib/db/src/schema/index.ts`) — kept as a local literal union
 * rather than importing the server's Drizzle schema type into this Vite app. */
export type AccountSecurityRole =
  | "PlatformAdmin" | "MSPAdmin" | "MSPOperator" | "CustomerUser" | "ServiceAccount" | "Free" | "Assessment";

export interface AccountSecurityUser {
  readonly id: number;
  readonly userId: number;
  readonly email: string;
  readonly name: string | null;
  readonly mspRole: AccountSecurityRole | null;
  readonly isActive: boolean;
  readonly mfaEnforced: boolean;
  readonly tenantId: number | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface MspSession {
  readonly id: number;
  readonly userId: number;
  readonly tokenHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly email: string;
  readonly name: string | null;
}

export interface AuditEntry {
  readonly id: number;
  readonly actorEmail: string | null;
  readonly actorName: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly outcome: "success" | "failure" | "partial";
  readonly createdAt: string;
  readonly detail: string | null;
}

/** A fetch that failed reports its real HTTP status, so the page can tell a
 * genuine 403 target-role-ceiling rejection (Git #3032/#3896) apart from a
 * generic failure — same pattern as `team-api.ts`'s `TeamApiError`. */
export class AccountSecurityApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
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
  return (await res.json()) as T;
}

const rosterKey = ["msp", "account-security", "roster"] as const;
const sessionsKey = ["msp", "account-security", "sessions"] as const;
const auditKey = (userId: number) => ["msp", "account-security", "audit", userId] as const;

export function useAccountRoster(): UseQueryResult<AccountSecurityUser[], AccountSecurityApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: rosterKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/settings/users");
      return parseJsonOrThrow<AccountSecurityUser[]>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useMspSessions(): UseQueryResult<MspSession[], AccountSecurityApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: sessionsKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/settings/sessions");
      return parseJsonOrThrow<MspSession[]>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useAccountAuditTrail(userId: number | null): UseQueryResult<AuditEntry[], AccountSecurityApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: auditKey(userId ?? -1),
    queryFn: async () => {
      const params = new URLSearchParams({ entityType: "msp_user", entityId: String(userId), limit: "8" });
      const res = await fetchWithAuth(`/api/msp/audit?${params.toString()}`);
      const body = await parseJsonOrThrow<{ entries: AuditEntry[] }>(res);
      return body.entries;
    },
    enabled: !isLoading && !!accessToken && userId != null,
    staleTime: 5_000,
  });
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>, userId: number) {
  void queryClient.invalidateQueries({ queryKey: rosterKey });
  void queryClient.invalidateQueries({ queryKey: sessionsKey });
  void queryClient.invalidateQueries({ queryKey: auditKey(userId) });
}

export function useSendAccountPasswordReset() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/reset-password`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true; message: string }>(res);
    },
    onSuccess: (_data, userId) => invalidateAll(queryClient, userId),
  });
}

export function useSetAccountTempPassword() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/temp-password`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true; tempPassword: string; requireChange: boolean }>(res);
    },
    onSuccess: (_data, userId) => invalidateAll(queryClient, userId),
  });
}

export function useResetAccountMfa() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/reset-mfa`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true; message: string }>(res);
    },
    onSuccess: (_data, userId) => invalidateAll(queryClient, userId),
  });
}

export function useSetAccountMfaEnforcement() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, enforced }: { userId: number; enforced: boolean }) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/mfa-enforcement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforced }),
      });
      return parseJsonOrThrow<{ ok: true; enforced: boolean }>(res);
    },
    onSuccess: (_data, { userId }) => invalidateAll(queryClient, userId),
  });
}

export function useSetAccountStatus() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, isActive }: { userId: number; isActive: boolean }) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      return parseJsonOrThrow<{ ok: true; isActive: boolean }>(res);
    },
    onSuccess: (_data, { userId }) => invalidateAll(queryClient, userId),
  });
}

export function useRevokeAccountSessions() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/sessions`, { method: "DELETE" });
      return parseJsonOrThrow<{ ok: true; revokedCount: number }>(res);
    },
    onSuccess: (_data, userId) => invalidateAll(queryClient, userId),
  });
}
