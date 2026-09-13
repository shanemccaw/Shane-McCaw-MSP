import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

/**
 * Session/auth for the MSP Console. This reuses the platform's existing
 * cookie-refresh + bearer-token pattern verbatim from the admin panel
 * (`artifacts/admin-panel/src/contexts/AuthContext.tsx`) — POST /api/auth/refresh
 * mints a short-lived access token from the httpOnly refresh cookie, which is
 * then attached as `Authorization: Bearer` on every API call. It deliberately
 * does NOT invent a new auth pattern.
 *
 * The one difference from the admin panel: an MSP operator is not necessarily
 * `role === "admin"` (an MSPOperator holds `role: "user"` with an MSP role), so
 * the refresh here does not reject non-admin users. The real MSP-scope decision
 * is made against `GET /api/msp/auth/me` in AuthGate, mirroring the backend gate
 * (`requireCapability("ladder.msp-operator")`).
 */

interface AuthState {
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<string | null>;
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  logout: () => Promise<void>;
  /**
   * Adopt an access token issued outside the refresh cycle — the real login,
   * MFA-verify, and bypass routes (screen 38) all mint one directly in their
   * JSON response and set the refresh cookie themselves via `Set-Cookie`; this
   * just makes that token live for `fetchWithAuth`/the generated client
   * without a redundant round-trip through `/api/auth/refresh`.
   */
  setSession: (accessToken: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const loginBase = () => import.meta.env.BASE_URL.replace(/\/$/, "");

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ accessToken: null, isLoading: true });

  const accessTokenRef = useRef<string | null>(null);
  accessTokenRef.current = state.accessToken;

  const refreshInFlight = useRef<Promise<string | null> | null>(null);
  // true only when the server explicitly rejected the refresh token (401);
  // stays false on transient 5xx/network errors so a brief API restart does
  // not sign the operator out.
  const sessionExpiredRef = useRef(false);

  const doRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      if (res.status === 401) {
        sessionExpiredRef.current = true;
        setState({ accessToken: null, isLoading: false });
        return null;
      }
      if (!res.ok) return null; // transient — preserve any existing session
      const data = (await res.json()) as { accessToken: string };
      sessionExpiredRef.current = false;
      setState({ accessToken: data.accessToken, isLoading: false });
      accessTokenRef.current = data.accessToken;
      return data.accessToken;
    } catch {
      return null; // network error — server temporarily unreachable
    }
  }, []);

  const refresh = useCallback((): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const p = doRefresh().finally(() => { refreshInFlight.current = null; });
    refreshInFlight.current = p;
    return p;
  }, [doRefresh]);

  // Feed the generated api-client (useMspAuthMe et al.) the live access token.
  useEffect(() => {
    setAuthTokenGetter(() => accessTokenRef.current);
    return () => { setAuthTokenGetter(null); };
  }, []);

  useEffect(() => {
    refresh()
      .then((token) => { if (!token) setState((s) => ({ ...s, isLoading: false })); })
      .catch(() => setState((s) => ({ ...s, isLoading: false })));
  }, [refresh]);

  // Refresh 5 minutes before expiry so a call never lands on a 401 mid-session.
  useEffect(() => {
    if (!state.accessToken) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = JSON.parse(atob(state.accessToken.split(".")[1])) as { exp?: number };
      if (typeof payload.exp === "number") {
        const ms = payload.exp * 1000 - Date.now() - 5 * 60 * 1000;
        if (ms <= 0) void refresh();
        else timer = setTimeout(() => void refresh(), ms);
      }
    } catch { /* ignore malformed token */ }
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [state.accessToken, refresh]);

  const fetchWithAuth = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      if (accessTokenRef.current) headers.set("Authorization", `Bearer ${accessTokenRef.current}`);
      if (typeof init?.body === "string" && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const res = await fetch(input, { ...init, credentials: "include", headers });
      if (res.status !== 401) return res;

      const token = await refresh();
      if (!token) return res;

      const retry = new Headers(init?.headers);
      retry.set("Authorization", `Bearer ${token}`);
      if (typeof init?.body === "string" && !retry.has("Content-Type")) {
        retry.set("Content-Type", "application/json");
      }
      return fetch(input, { ...init, credentials: "include", headers: retry });
    },
    [refresh],
  );

  const setSession = useCallback((accessToken: string) => {
    sessionExpiredRef.current = false;
    accessTokenRef.current = accessToken;
    setState({ accessToken, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch { /* always clear locally */ }
    accessTokenRef.current = null;
    setState({ accessToken: null, isLoading: false });
    window.location.replace(`${loginBase()}/login`);
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, refresh, fetchWithAuth, logout, setSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
