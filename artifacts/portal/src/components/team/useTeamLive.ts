import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { toTeamMember, type TeamMember, type WireTeamMember } from "./teamWire";

/**
 * Live data + write actions for the Team Management page (#3996, part of
 * #1656). All twelve real routes on `portal-team.ts` — see
 * `docs/portal/team-management-and-invitations-contract-pack.md` (#2895) for
 * §-numbered citations, and this hook's own inline comments for the two
 * routes (`/role`, and the `managerUserId`/`isCustomerAdmin`/`hasBillingRole`
 * fields on the roster read) that landed after that pack was generated.
 */

const TEAM_URL = "/api/portal/team";
const INVITE_URL = "/api/portal/team/invite";

export interface InviteInput {
  email: string;
  name?: string;
  department?: string;
  jobTitle?: string;
}

export interface TeamLiveState {
  readonly members: TeamMember[] | null;
  readonly loading: boolean;
  readonly readFailed: boolean;
  readonly refetch: () => void;

  readonly invite: (input: InviteInput) => Promise<string | null>;
  readonly inviting: boolean;

  readonly setStatus: (userId: number, isActive: boolean) => Promise<string | null>;
  readonly signOutEverywhere: (userId: number) => Promise<{ revokedCount: number } | string>;
  readonly setMfaEnforced: (userId: number, enforced: boolean) => Promise<string | null>;
  readonly unlock: (userId: number) => Promise<string | null>;
  readonly sendPasswordReset: (userId: number) => Promise<string | null>;
  readonly setTempPassword: (userId: number) => Promise<{ tempPassword: string } | string>;
  readonly resetMfa: (userId: number) => Promise<{ clearedMethods: string[] } | string>;
  readonly generateBypassCode: (userId: number) => Promise<{ bypassCode: string; expiresAt: string } | string>;
  readonly setManager: (userId: number, managerUserId: number | null) => Promise<string | null>;

  readonly actionPending: boolean;
}

export function useTeamLive(): TeamLiveState {
  const { fetchWithAuth, user } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    fetchWithAuth(TEAM_URL, undefined, { silent: true })
      .then(async (res) => {
        if (!res.ok) throw new Error(`team ${res.status}`);
        return (await res.json()) as WireTeamMember[];
      })
      .then((rows) => {
        if (cancelled) return;
        setMembers(rows.map(toTeamMember));
        setReadFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setReadFailed(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, fetchWithAuth, attempt]);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  const invite = useCallback(
    async (input: InviteInput): Promise<string | null> => {
      setInviting(true);
      try {
        const res = await fetchWithAuth(
          INVITE_URL,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
          { silent: true },
        );
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) return body.error ?? `Request failed (${res.status})`;
        refetch();
        return null;
      } finally {
        setInviting(false);
      }
    },
    [fetchWithAuth, refetch],
  );

  const patchMember = useCallback((userId: number, patch: Partial<TeamMember>) => {
    setMembers((prev) => (prev ? prev.map((m) => (m.userId === userId ? { ...m, ...patch } : m)) : prev));
  }, []);

  const runMutation = useCallback(
    async <T,>(
      url: string,
      method: "POST" | "PATCH" | "DELETE",
      body: unknown,
      onSuccess: (body: T) => void,
    ): Promise<string | null> => {
      setActionPending(true);
      try {
        const res = await fetchWithAuth(
          url,
          {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          },
          { silent: true },
        );
        const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) return (json as { error?: string }).error ?? `Request failed (${res.status})`;
        onSuccess(json);
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        setActionPending(false);
      }
    },
    [fetchWithAuth],
  );

  const setStatus = useCallback(
    async (userId: number, isActive: boolean): Promise<string | null> => {
      const err = await runMutation<{ isActive: boolean }>(
        `${TEAM_URL}/${userId}/status`,
        "PATCH",
        { isActive },
        () => {
          patchMember(userId, isActive ? { isActive: true } : { isActive: false, activeSessionsCount: 0 });
          toast.success(isActive ? "Reactivated" : "Suspended");
        },
      );
      return err;
    },
    [runMutation, patchMember],
  );

  const signOutEverywhere = useCallback(
    async (userId: number): Promise<{ revokedCount: number } | string> => {
      setActionPending(true);
      try {
        const res = await fetchWithAuth(`${TEAM_URL}/${userId}/sessions`, { method: "DELETE" }, { silent: true });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; revokedCount?: number };
        if (!res.ok || !body.ok) return body.error ?? `Request failed (${res.status})`;
        patchMember(userId, { activeSessionsCount: 0 });
        return { revokedCount: body.revokedCount ?? 0 };
      } finally {
        setActionPending(false);
      }
    },
    [fetchWithAuth, patchMember],
  );

  const setMfaEnforced = useCallback(
    async (userId: number, enforced: boolean): Promise<string | null> =>
      runMutation<{ mfaEnforced: boolean }>(`${TEAM_URL}/${userId}/mfa-enforcement`, "PATCH", { enforced }, () => {
        patchMember(userId, { mfaEnforced: enforced });
        toast.success(enforced ? "MFA now required" : "MFA no longer required");
      }),
    [runMutation, patchMember],
  );

  const unlock = useCallback(
    async (userId: number): Promise<string | null> =>
      runMutation<{ isLockedOut: boolean }>(`${TEAM_URL}/${userId}/unlock`, "POST", undefined, () => {
        patchMember(userId, { isLockedOut: false });
        toast.success("Unlocked");
      }),
    [runMutation, patchMember],
  );

  const sendPasswordReset = useCallback(
    async (userId: number): Promise<string | null> =>
      runMutation<Record<string, never>>(`${TEAM_URL}/${userId}/reset-password`, "POST", undefined, () => {
        toast.success("Reset email sent");
      }),
    [runMutation],
  );

  const setTempPassword = useCallback(
    async (userId: number): Promise<{ tempPassword: string } | string> => {
      setActionPending(true);
      try {
        const res = await fetchWithAuth(`${TEAM_URL}/${userId}/temp-password`, { method: "POST" }, { silent: true });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; tempPassword?: string };
        if (!res.ok || !body.ok || !body.tempPassword) return body.error ?? `Request failed (${res.status})`;
        return { tempPassword: body.tempPassword };
      } finally {
        setActionPending(false);
      }
    },
    [fetchWithAuth],
  );

  const resetMfa = useCallback(
    async (userId: number): Promise<{ clearedMethods: string[] } | string> => {
      setActionPending(true);
      try {
        const res = await fetchWithAuth(`${TEAM_URL}/${userId}/reset-mfa`, { method: "POST" }, { silent: true });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; clearedMethods?: string[] };
        if (!res.ok || !body.ok) return body.error ?? `Request failed (${res.status})`;
        patchMember(userId, { mfaStatus: "Disabled" });
        return { clearedMethods: body.clearedMethods ?? [] };
      } finally {
        setActionPending(false);
      }
    },
    [fetchWithAuth, patchMember],
  );

  const generateBypassCode = useCallback(
    async (userId: number): Promise<{ bypassCode: string; expiresAt: string } | string> => {
      setActionPending(true);
      try {
        const res = await fetchWithAuth(`${TEAM_URL}/${userId}/emergency-bypass`, { method: "POST" }, { silent: true });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          bypassCode?: string;
          expiresAt?: string;
        };
        if (!res.ok || !body.ok || !body.bypassCode || !body.expiresAt) return body.error ?? `Request failed (${res.status})`;
        return { bypassCode: body.bypassCode, expiresAt: body.expiresAt };
      } finally {
        setActionPending(false);
      }
    },
    [fetchWithAuth],
  );

  const setManager = useCallback(
    async (userId: number, managerUserId: number | null): Promise<string | null> =>
      runMutation<{ managerUserId: number | null }>(
        `${TEAM_URL}/${userId}/manager`,
        "PATCH",
        { managerUserId },
        () => {
          patchMember(userId, { managerUserId });
        },
      ),
    [runMutation, patchMember],
  );

  return {
    members,
    loading,
    readFailed,
    refetch,
    invite,
    inviting,
    setStatus,
    signOutEverywhere,
    setMfaEnforced,
    unlock,
    sendPasswordReset,
    setTempPassword,
    resetMfa,
    generateBypassCode,
    setManager,
    actionPending,
  };
}
