/**
 * useAccountSecurityLive.ts — real per-portal-login data for the Account
 * Security page (Git #1235).
 *
 * ── This is the customer's own portal login, not their M365 tenant ─────────
 * The page's own header copy draws that line, and so does this hook: it never
 * touches Graph/tenant data (that's `useMfaRegistrationLive.ts` et al. for the
 * pillar pages). Everything here reads the portal's own auth tables via
 * endpoints that already exist in `artifacts/api-server/src/routes/auth.ts`:
 *
 *   GET  /api/auth/mfa/enrollments      — this user's MFA methods
 *   GET  /api/auth/sessions             — this user's active portal sessions
 *   DELETE /api/auth/sessions/:id       — revoke one session
 *   POST /api/auth/sessions/revoke-others — sign out every other session
 *   GET  /api/auth/login-history        — most-recent-first login rows
 *
 * Identity (email, role) needs no fetch at all — it's already on the decoded
 * JWT via `useAuth().user`.
 *
 * ── What stays fixture, and why (documented at #1235's own request) ────────
 * - Password age / "last changed": `usersTable` has no `passwordChangedAt`
 *   column. A real prerequisite gap, not a wiring gap — flagged, not faked.
 * - "Failed attempts": `users.failedLoginAttempts` is a real column but no
 *   endpoint exposes it to the owning user yet — a smaller follow-up.
 * - Device compliance ("hybrid joined", "Intune enrolled"): Entra/Intune
 *   device state, out of scope for a portal-login page by the page's own
 *   framing. Live sessions carry no compliance claim rather than a fabricated
 *   one — `compliant` comes back empty and the page omits that segment.
 * - MFA method how/why/tradeoff copy, and the "Your data" / delete-account
 *   sections: static design/policy copy, not per-account state. The page's
 *   own doc comment already scoped action buttons there as a later pass.
 */
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { timeAgo } from "./overviewModel";
import type { SecSession } from "./accountSecurityData";

const MFA_ENROLLMENTS_URL = "/api/auth/mfa/enrollments";
const SESSIONS_URL = "/api/auth/sessions";
const SESSIONS_REVOKE_OTHERS_URL = "/api/auth/sessions/revoke-others";
const LOGIN_HISTORY_URL = "/api/auth/login-history";

export interface LiveMfaEnrollments {
  readonly totp: boolean;
  readonly sms: boolean;
  readonly smsPhone: string | null;
  readonly passkey: boolean;
  readonly passkeyCount: number;
}

interface WireSessionRow {
  readonly id: number;
  readonly browser: string;
  readonly os: string;
  readonly ipAddress: string | null;
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly isCurrent: boolean;
}

interface WireLoginHistoryRow {
  readonly id: number;
  readonly createdAt: string;
  readonly ipAddress: string | null;
}

/** A live session row — same shape the page already renders, plus the real id a revoke action needs. */
export interface LiveSecSession extends SecSession {
  readonly id: number;
}

function toSecSession(row: WireSessionRow): LiveSecSession {
  return {
    id: row.id,
    device: `${row.os} · ${row.browser}`,
    where: row.ipAddress ?? "IP unavailable",
    when: row.isCurrent ? "Active now" : timeAgo(row.lastActiveAt),
    current: row.isCurrent,
    since: `Signed in ${timeAgo(row.createdAt)}`,
    // No device-compliance signal exists for a portal login — left blank
    // rather than claiming "Compliant"/"Unmanaged" without real data.
    compliant: "",
  };
}

export interface AccountSecurityLiveState {
  readonly identityEmail: string | null;
  readonly identityRole: string | null;
  readonly mfa: LiveMfaEnrollments | null;
  readonly sessions: readonly LiveSecSession[] | null;
  readonly lastSignInAt: string | null;
  /** "live" once every live slice has resolved (success or failure); individual pieces fall back to fixture on their own. */
  readonly dataState: "live" | "fixture";
  readonly loading: boolean;
  readonly revokeSession: (id: number) => Promise<boolean>;
  readonly signOutOthers: () => Promise<number>;
}

const MSP_ROLE_LABELS: Record<string, string> = {
  PlatformAdmin: "Platform Administrator · full platform access",
  MSPAdmin: "MSP Administrator · full portal access",
  MSPOperator: "MSP Operator · operational portal access",
  CustomerUser: "Customer User · full portal access",
  ServiceAccount: "Service Account",
  Free: "Free tier",
  Assessment: "Assessment",
};

export function useAccountSecurityLive(): AccountSecurityLiveState {
  const { user, fetchWithAuth } = useAuth();
  const [mfa, setMfa] = useState<LiveMfaEnrollments | null>(null);
  const [sessions, setSessions] = useState<readonly LiveSecSession[] | null>(null);
  const [lastSignInAt, setLastSignInAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetchWithAuth(SESSIONS_URL, undefined, { silent: true });
      if (!res.ok) throw new Error(`sessions ${res.status}`);
      const body = (await res.json()) as { sessions?: readonly WireSessionRow[] };
      setSessions((body?.sessions ?? []).map(toSecSession));
    } catch {
      setSessions(null);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(MFA_ENROLLMENTS_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`mfa enrollments ${res.status}`);
        const body = (await res.json()) as {
          totp?: boolean;
          sms?: boolean;
          smsPhone?: string | null;
          passkey?: boolean;
          passkeyCount?: number;
        };
        if (!cancelled) {
          setMfa({
            totp: !!body.totp,
            sms: !!body.sms,
            smsPhone: body.smsPhone ?? null,
            passkey: !!body.passkey,
            passkeyCount: body.passkeyCount ?? 0,
          });
        }
      } catch {
        if (!cancelled) setMfa(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadSessions();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(LOGIN_HISTORY_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`login history ${res.status}`);
        const body = (await res.json()) as { history?: readonly WireLoginHistoryRow[] };
        const mostRecent = (body?.history ?? [])[0];
        if (!cancelled) setLastSignInAt(mostRecent?.createdAt ?? null);
      } catch {
        if (!cancelled) setLastSignInAt(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const revokeSession = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        const res = await fetchWithAuth(`${SESSIONS_URL}/${id}`, { method: "DELETE" }, { silent: true });
        if (!res.ok) return false;
        await loadSessions();
        return true;
      } catch {
        return false;
      }
    },
    [fetchWithAuth, loadSessions],
  );

  const signOutOthers = useCallback(async (): Promise<number> => {
    try {
      const res = await fetchWithAuth(SESSIONS_REVOKE_OTHERS_URL, { method: "POST" }, { silent: true });
      if (!res.ok) return 0;
      const body = (await res.json()) as { revokedCount?: number };
      await loadSessions();
      return body.revokedCount ?? 0;
    } catch {
      return 0;
    }
  }, [fetchWithAuth, loadSessions]);

  return {
    identityEmail: user?.email ?? null,
    identityRole: user?.mspRole ? (MSP_ROLE_LABELS[user.mspRole] ?? user.mspRole) : null,
    mfa,
    sessions,
    lastSignInAt,
    dataState: mfa !== null && sessions !== null ? "live" : "fixture",
    loading,
    revokeSession,
    signOutOthers,
  };
}
