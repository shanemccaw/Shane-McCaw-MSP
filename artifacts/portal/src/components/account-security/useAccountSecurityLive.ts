import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

/**
 * Live data + write actions for the Account Security page (#2996, part of
 * #1595). Wire contracts cited against
 * `Design/portal/design_handoff_full_site/docs/portal/account-security-contract-pack.md`.
 *
 * Scope note: this hook wires every read/action that is genuinely #2996's own
 * responsibility (identity, MFA-state read, sessions read + revoke,
 * last-sign-in, data export, deletion request). Change-password and MFA
 * self-service enrollment writes are deliberately NOT wired here — those are
 * #1675 and the MFA-enrollment sibling issue's own scope, and the design
 * itself marks those CTAs "Not wired yet" (`Account Security.dc.html`).
 */

const MFA_URL = "/api/auth/mfa/enrollments";
const SESSIONS_URL = "/api/auth/sessions";
const LOGIN_HISTORY_URL = "/api/auth/login-history";
const DATA_EXPORT_URL = "/api/portal/data-export";
const DELETION_REQUEST_URL = "/api/portal/deletion-request";

export interface LiveMfaEnrollments {
  readonly totp: boolean;
  readonly sms: boolean;
  readonly smsPhone: string | null;
  readonly passkey: boolean;
  readonly passkeyCount: number;
}

interface WireSessionRow {
  id: number;
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

export interface LiveSecSession {
  readonly id: number;
  readonly device: string;
  readonly where: string;
  readonly when: string;
  readonly current: boolean;
  readonly since: string;
}

function toSecSession(row: WireSessionRow): LiveSecSession {
  return {
    id: row.id,
    device: `${row.os} · ${row.browser}`,
    where: row.ipAddress ?? "IP unavailable",
    when: row.isCurrent ? "Active now" : `${formatDistanceToNowStrict(new Date(row.lastActiveAt))} ago`,
    current: row.isCurrent,
    since: `Signed in ${formatDistanceToNowStrict(new Date(row.createdAt))} ago`,
  };
}

/** Real `login_method` enum, `user_sessions.login_method` (`lib/db/src/schema/msp.ts:696`). */
export type LoginMethod = "password" | "totp" | "sms" | "passkey" | "impersonation" | "bypass";

/**
 * `LoginHistoryView` (`session-tracking.ts:171-179`), the full six-field shape
 * `GET /auth/login-history` (`auth.ts:909-913`) actually returns. Previously only
 * `id`/`createdAt`/`ipAddress` were parsed here — `loginMethod`, `browser`, `os`,
 * `revoked` were real fields the route already sent and this client discarded (#1603).
 */
interface WireLoginHistoryRow {
  id: number;
  loginMethod: LoginMethod;
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: string;
  revoked: boolean;
}

export interface LiveLoginHistoryRow {
  readonly id: number;
  readonly loginMethod: LoginMethod;
  readonly browser: string;
  readonly os: string;
  readonly ipAddress: string | null;
  readonly createdAt: string;
  readonly revoked: boolean;
}

export interface AccountSecurityLiveState {
  readonly mfa: LiveMfaEnrollments | null;
  readonly sessions: LiveSecSession[] | null;
  readonly lastSignInAt: string | null;
  /** Full sign-in history, all six real fields — null only on a genuine read failure, never on an honest-empty result. */
  readonly loginHistory: LiveLoginHistoryRow[] | null;
  /** loading until MFA + sessions + login-history have all settled at least once */
  readonly loading: boolean;
  /** true only when a read genuinely failed (never for an honest-empty result) */
  readonly readFailed: boolean;
  readonly revokeSession: (id: number) => Promise<void>;
  readonly signOutOthers: () => Promise<void>;
  readonly revoking: Record<number, boolean>;
  readonly revokingOthers: boolean;
  /** Right to portability — GET /api/portal/data-export, triggers a real file download */
  readonly requestExport: () => Promise<void>;
  readonly exporting: boolean;
  /** Right to erasure — POST /api/portal/deletion-request */
  readonly submitDeletionRequest: () => Promise<{ ok: boolean; message: string } | null>;
  readonly submittingDeletion: boolean;
  readonly refetch: () => void;
}

export function useAccountSecurityLive(): AccountSecurityLiveState {
  const { fetchWithAuth, user } = useAuth();
  const [mfa, setMfa] = useState<LiveMfaEnrollments | null>(null);
  const [sessions, setSessions] = useState<LiveSecSession[] | null>(null);
  const [lastSignInAt, setLastSignInAt] = useState<string | null>(null);
  const [loginHistory, setLoginHistory] = useState<LiveLoginHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [revoking, setRevoking] = useState<Record<number, boolean>>({});
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submittingDeletion, setSubmittingDeletion] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchWithAuth(MFA_URL, undefined, { silent: true }).then(async (res) => {
        if (!res.ok) throw new Error(`mfa ${res.status}`);
        return (await res.json()) as LiveMfaEnrollments;
      }),
      fetchWithAuth(SESSIONS_URL, undefined, { silent: true }).then(async (res) => {
        if (!res.ok) throw new Error(`sessions ${res.status}`);
        const body = (await res.json()) as { sessions: WireSessionRow[] };
        return body.sessions;
      }),
      fetchWithAuth(LOGIN_HISTORY_URL, undefined, { silent: true }).then(async (res) => {
        if (!res.ok) throw new Error(`login-history ${res.status}`);
        const body = (await res.json()) as { history: WireLoginHistoryRow[] };
        return body.history;
      }),
    ])
      .then(([mfaBody, sessionRows, historyRows]) => {
        if (cancelled) return;
        setMfa(mfaBody);
        setSessions(sessionRows.map(toSecSession));
        setLastSignInAt(historyRows[0]?.createdAt ?? null);
        setLoginHistory(historyRows);
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

  const revokeSession = useCallback(
    async (id: number) => {
      setRevoking((r) => ({ ...r, [id]: true }));
      try {
        const res = await fetchWithAuth(`${SESSIONS_URL}/${id}`, { method: "DELETE" });
        if (!res.ok) return;
        setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
        toast.success("Session revoked");
      } finally {
        setRevoking((r) => {
          const next = { ...r };
          delete next[id];
          return next;
        });
      }
    },
    [fetchWithAuth],
  );

  const signOutOthers = useCallback(async () => {
    setRevokingOthers(true);
    try {
      const res = await fetchWithAuth(`${SESSIONS_URL}/revoke-others`, { method: "POST" });
      if (!res.ok) return;
      setSessions((prev) => (prev ? prev.filter((s) => s.current) : prev));
      toast.success("Signed out of every other session");
    } finally {
      setRevokingOthers(false);
    }
  }, [fetchWithAuth]);

  const requestExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetchWithAuth(DATA_EXPORT_URL);
      if (!res.ok) return;
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `data-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Your data export has downloaded");
    } finally {
      setExporting(false);
    }
  }, [fetchWithAuth]);

  const submitDeletionRequest = useCallback(async (): Promise<{ ok: boolean; message: string } | null> => {
    setSubmittingDeletion(true);
    try {
      const res = await fetchWithAuth(DELETION_REQUEST_URL, { method: "POST" });
      if (!res.ok) return null;
      const body = (await res.json()) as { ok: boolean; message: string };
      toast.success("Deletion request received");
      return body;
    } finally {
      setSubmittingDeletion(false);
    }
  }, [fetchWithAuth]);

  return {
    mfa,
    sessions,
    lastSignInAt,
    loginHistory,
    loading,
    readFailed,
    revokeSession,
    signOutOthers,
    revoking,
    revokingOthers,
    requestExport,
    exporting,
    submitDeletionRequest,
    submittingDeletion,
    refetch,
  };
}
