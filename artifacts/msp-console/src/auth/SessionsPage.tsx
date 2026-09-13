import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLayout, PrimaryButton, GhostButton, InlineMessage } from "./AuthLayout";
import { AuthApiError } from "./authApi";
import { border, signal, text } from "@/console/tokens";

interface ActiveSession {
  id: number;
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

interface LoginHistoryRow {
  id: number;
  loginMethod: string;
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: string;
  revoked: boolean;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new AuthApiError(res.status, data as Record<string, unknown>);
  return data;
}

export default function SessionsPage() {
  const { accessToken, isLoading: sessionLoading, fetchWithAuth, logout } = useAuth();
  const [, setLocation] = useLocation();

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [history, setHistory] = useState<LoginHistoryRow[]>([]);
  const [alert, setAlert] = useState<{ tone: "ok" | "warning" | "critical"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sRes, hRes] = await Promise.all([
        fetchWithAuth("/api/auth/sessions"),
        fetchWithAuth("/api/auth/login-history"),
      ]);
      const [s, h] = await Promise.all([
        readJson<{ sessions: ActiveSession[] }>(sRes),
        readJson<{ history: LoginHistoryRow[] }>(hRes),
      ]);
      setSessions(s.sessions);
      setHistory(h.history);
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 403) {
        setAlert({ tone: "critical", text: "This session hasn't finished MFA enrollment yet. Finish setting up two-factor first." });
      } else {
        setAlert({ tone: "critical", text: "Could not load your sessions." });
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!accessToken) { setLocation("/login"); return; }
    void load();
  }, [accessToken, sessionLoading, setLocation, load]);

  async function revokeOne(id: number) {
    setBusy(true);
    try {
      await fetchWithAuth(`/api/auth/sessions/${id}`, { method: "DELETE" });
      setAlert({ tone: "ok", text: "That device is out. It keeps API access until its current access token expires." });
      await load();
    } catch {
      setAlert({ tone: "critical", text: "Failed to revoke that session." });
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    try {
      const res = await fetchWithAuth("/api/auth/sessions/revoke-others", { method: "POST" });
      await readJson<{ ok: true; revokedCount: number }>(res);
      setAlert({ tone: "ok", text: "Every other session is closed." });
      await load();
    } catch {
      setAlert({ tone: "critical", text: "Failed to revoke other sessions." });
    } finally {
      setBusy(false);
    }
  }

  if (sessionLoading || loading) {
    return (
      <AuthLayout caption="Sessions">
        <span style={{ fontSize: 12.5, color: text.muted }}>Loading…</span>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout caption="Sessions">
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: text.strong }}>Where you are signed in</span>
        <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
          Built from session rows, newest activity first. Device and location come from the user agent and IP recorded when the token was issued.
        </span>
      </span>

      {alert && <InlineMessage tone={alert.tone} text={alert.text} />}

      {sessions.length === 0 ? (
        <div style={{ border: `1px dashed ${border.card}`, borderRadius: 10, padding: 20, display: "flex", flexDirection: "column", gap: 6, textAlign: "center", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>No active sessions</span>
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", maxWidth: 360 }}>
            Every refresh token for this account is revoked or expired.
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {sessions.map((s) => (
            <div key={s.id} style={{ border: `1px solid ${s.isCurrent ? "rgba(52,211,153,.18)" : border.card}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 180, flex: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>{s.browser} on {s.os}</span>
                <span style={{ fontSize: 11, color: text.label }}>
                  {s.ipAddress ?? "unknown IP"} · last active {new Date(s.lastActiveAt).toLocaleString()}
                </span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: s.isCurrent ? signal.ok.tint : signal.neutral.tint, border: `1px solid ${s.isCurrent ? signal.ok.border : signal.neutral.border}`, fontSize: 10.5, fontWeight: 600, color: s.isCurrent ? signal.ok.strong : signal.neutral.strong }}>
                {s.isCurrent ? "Current" : "Active"}
              </span>
              {s.isCurrent ? (
                <GhostButton disabled>This device</GhostButton>
              ) : (
                <GhostButton onClick={() => void revokeOne(s.id)} disabled={busy}>Revoke</GhostButton>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <PrimaryButton onClick={() => void logout()} disabled={busy}>Sign out of this device</PrimaryButton>
        <GhostButton onClick={() => void revokeOthers()} disabled={busy || sessions.length <= 1}>Sign out everywhere else</GhostButton>
      </div>

      <div style={{ borderTop: `1px solid ${border.soft}`, paddingTop: 13, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>LOGIN HISTORY</span>
        {history.length === 0 ? (
          <span style={{ fontSize: 11.5, color: text.label }}>No login history recorded yet.</span>
        ) : (
          history.slice(0, 8).map((h) => (
            <div key={h.id} style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontFamily: "Menlo, monospace", color: h.revoked ? text.label : signal.ok.strong, minWidth: 62 }}>{h.loginMethod}</span>
              <span style={{ fontSize: 11.5, color: text.secondary, flex: 1, minWidth: 140, textWrap: "pretty" }}>
                {new Date(h.createdAt).toLocaleString()} · {h.browser} on {h.os} · {h.ipAddress ?? "unknown IP"}
              </span>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => setLocation("/tenants")}
        style={{ background: "none", border: "none", padding: 0, color: "#60a5fa", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}
      >
        ← Back to the console
      </button>
    </AuthLayout>
  );
}
