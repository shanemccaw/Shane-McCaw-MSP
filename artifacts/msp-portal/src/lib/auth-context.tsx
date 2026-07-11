/**
 * MSP Portal AuthContext
 *
 * Provides:
 *   - accessToken (in-memory only — never stored in localStorage)
 *   - user (parsed from JWT)
 *   - login / logout helpers
 *   - Silent access-token refresh every ~14 min via /api/auth/refresh
 *   - "Are you still there?" modal 30 s before the 7-day REFRESH token expires
 *   - fetchWithAuth: like fetch() but injects Bearer token + handles 401 refresh
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MspRole =
  | "PlatformAdmin"
  | "MSPAdmin"
  | "MSPOperator"
  | "CustomerUser"
  | "ServiceAccount"
  | "Free";

export interface AuthUser {
  id: number;
  email: string;
  name?: string;
  role: "admin" | "client";
  mspRole?: MspRole;
  mspId?: number;
  customerId?: number;
  impersonatedBy?: number;
  /** Unix timestamp (seconds) when this access token expires */
  exp?: number;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  /** true while an automatic refresh is in-flight */
  isRefreshing: boolean;
  /**
   * true when the "are you still there?" warning is showing.
   * Triggered 30 s before the 7-day REFRESH token expires — not the 15-min
   * access token, which silently auto-renews without user intervention.
   */
  isExpiringSoon: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ mfaRequired?: boolean; mfaToken?: string; methods?: string[] }>;
  logout: () => Promise<void>;
  extendSession: () => Promise<void>;
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Warn the user this many milliseconds before the REFRESH token expires */
const WARN_BEFORE_REFRESH_EXPIRY_MS = 30_000; // 30 seconds

/**
 * How often to silently refresh the access token.
 * Slightly shorter than the 15-min window so we never send an expired token.
 */
const SILENT_REFRESH_INTERVAL_MS = 13 * 60 * 1000; // 13 minutes

/** sessionStorage keys */
const REFRESH_TOKEN_KEY = "msp_refresh_token";
const REFRESH_EXPIRES_AT_KEY = "msp_refresh_expires_at";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJwt(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload as AuthUser;
  } catch {
    return null;
  }
}

/** Ms until the refresh token expires (not the 15-min access token). */
function msUntilRefreshExpiry(): number {
  const stored = sessionStorage.getItem(REFRESH_EXPIRES_AT_KEY);
  if (!stored) return 0;
  return new Date(stored).getTime() - Date.now();
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isRefreshing: false,
    isExpiringSoon: false,
  });

  /** Timer that fires 30 s before the refresh token expires */
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Periodic timer for silent access-token refresh */
  const silentRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null);

  // ── Timer management ─────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (silentRefreshTimerRef.current) clearInterval(silentRefreshTimerRef.current);
    warnTimerRef.current = null;
    silentRefreshTimerRef.current = null;
  }, []);

  // ── Apply tokens received from login/refresh response ────────────────────

  const applyTokens = useCallback(
    (accessToken: string, refreshToken?: string, refreshExpiresAt?: string) => {
      const user = parseJwt(accessToken);
      if (!user) return;

      if (refreshToken) {
        sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
      if (refreshExpiresAt) {
        sessionStorage.setItem(REFRESH_EXPIRES_AT_KEY, refreshExpiresAt);
      }

      setState((s) => ({
        ...s,
        user,
        accessToken,
        isLoading: false,
        isRefreshing: false,
        isExpiringSoon: false,
      }));

      // Schedule the "are you still there?" warning 30 s before the REFRESH token expires
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      const msLeft = msUntilRefreshExpiry();
      const warnAt = msLeft - WARN_BEFORE_REFRESH_EXPIRY_MS;
      if (warnAt > 0) {
        warnTimerRef.current = setTimeout(() => {
          setState((s) => ({ ...s, isExpiringSoon: true }));
        }, warnAt);
      } else if (msLeft > 0) {
        // Already inside the warning window
        setState((s) => ({ ...s, isExpiringSoon: true }));
      }
    },
    [],
  );

  // ── Refresh (silent) ─────────────────────────────────────────────────────

  const doRefresh = useCallback(async (): Promise<string | null> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const promise = (async () => {
      const storedRefresh = sessionStorage.getItem(REFRESH_TOKEN_KEY);
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(storedRefresh ? { refreshToken: storedRefresh } : {}),
        });

        if (!res.ok) {
          // Refresh token has expired — truly log out
          setState({ user: null, accessToken: null, isLoading: false, isRefreshing: false, isExpiringSoon: false });
          sessionStorage.removeItem(REFRESH_TOKEN_KEY);
          sessionStorage.removeItem(REFRESH_EXPIRES_AT_KEY);
          clearTimers();
          return null;
        }

        const data = (await res.json()) as {
          accessToken: string;
          refreshToken?: string;
          refreshExpiresAt?: string;
        };
        applyTokens(data.accessToken, data.refreshToken, data.refreshExpiresAt);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = promise;
    return promise;
  }, [applyTokens, clearTimers]);

  // ── Boot: attempt silent refresh ─────────────────────────────────────────

  useEffect(() => {
    void doRefresh().then((token) => {
      if (!token) {
        setState((s) => ({ ...s, isLoading: false }));
      } else {
        // Start periodic silent access-token refresh
        silentRefreshTimerRef.current = setInterval(() => {
          void doRefresh();
        }, SILENT_REFRESH_INTERVAL_MS);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  // ── Public API ───────────────────────────────────────────────────────────

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = (await res.json()) as {
        accessToken?: string;
        refreshToken?: string;
        refreshExpiresAt?: string;
        mfaRequired?: boolean;
        mfaToken?: string;
        methods?: string[];
        error?: string;
      };

      if (!res.ok) throw new Error(data.error ?? "Login failed");

      if (data.mfaRequired) {
        return { mfaRequired: true, mfaToken: data.mfaToken, methods: data.methods };
      }

      if (data.accessToken) {
        applyTokens(data.accessToken, data.refreshToken, data.refreshExpiresAt);

        // Start periodic silent access-token refresh after login
        if (silentRefreshTimerRef.current) clearInterval(silentRefreshTimerRef.current);
        silentRefreshTimerRef.current = setInterval(() => {
          void doRefresh();
        }, SILENT_REFRESH_INTERVAL_MS);
      }

      return {};
    },
    [applyTokens, doRefresh],
  );

  const logout = useCallback(async () => {
    const storedRefresh = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(storedRefresh ? { refreshToken: storedRefresh } : {}),
      });
    } catch {
      // ignore
    }
    clearTimers();
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_EXPIRES_AT_KEY);
    setState({ user: null, accessToken: null, isLoading: false, isRefreshing: false, isExpiringSoon: false });
  }, [clearTimers]);

  const extendSession = useCallback(async () => {
    setState((s) => ({ ...s, isExpiringSoon: false, isRefreshing: true }));
    await doRefresh();
  }, [doRefresh]);

  const fetchWithAuth = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let token = state.accessToken;

      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);

      let res = await fetch(input, { ...init, headers });

      if (res.status === 401) {
        // Access token may have expired mid-request — try one silent refresh
        const refreshed = await doRefresh();
        if (refreshed) {
          token = refreshed;
          const headers2 = new Headers(init?.headers);
          headers2.set("Authorization", `Bearer ${token}`);
          res = await fetch(input, { ...init, headers: headers2 });
        }
      }

      // Surface non-OK responses as toasts so every caller gets consistent
      // error feedback without each page needing its own error handler.
      if (!res.ok && res.status !== 401) {
        let message = `Request failed (${res.status})`;
        try {
          const clone = res.clone();
          const data = (await clone.json()) as { error?: string; message?: string };
          if (data.error) message = data.error;
          else if (data.message) message = data.message;
        } catch {
          // body not JSON — keep generic message
        }
        toast.error(message);
      }

      return res;
    },
    [state.accessToken, doRefresh],
  );

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    extendSession,
    fetchWithAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
