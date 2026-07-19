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
import { reportClientEvent } from "./report-client-event";

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
  mspSlug?: string;
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
  /** true when impersonating another user */
  isImpersonating: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ mfaRequired?: boolean; mfaToken?: string; methods?: string[]; user?: AuthUser }>;
  /** Complete an MFA flow by supplying the tokens received from the MFA challenge endpoint */
  completeMfaLogin: (accessToken: string, refreshToken?: string, refreshExpiresAt?: string) => void;
  logout: () => Promise<void>;
  extendSession: () => Promise<void>;
  fetchWithAuth: (
    input: RequestInfo | URL,
    init?: RequestInit,
    opts?: { silent?: boolean },
  ) => Promise<Response>;
  /** true while impersonating another user */
  isImpersonating: boolean;
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

/**
 * Mirror of the current access token, kept in sync alongside AuthState.
 * Exists so the top-level ErrorBoundary (a class component that must sit
 * above this provider to catch crashes anywhere, including inside auth
 * plumbing) can attach a token to its crash beacon without needing the hook.
 */
let currentAccessToken: string | null = null;
export function getCurrentAccessToken(): string | null {
  return currentAccessToken;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isRefreshing: false,
    isExpiringSoon: false,
    isImpersonating: false,
  });

  /** Timer that fires 30 s before the refresh token expires */
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Periodic timer for silent access-token refresh */
  const silentRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref to track impersonation flag for timer decisions
  const isImpersonatingRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null);

  // ── Timer management ─────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (silentRefreshTimerRef.current) clearInterval(silentRefreshTimerRef.current);
    warnTimerRef.current = null;
    silentRefreshTimerRef.current = null;
    isImpersonatingRef.current = false;
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
        isImpersonating: false,
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
          setState({ user: null, accessToken: null, isLoading: false, isRefreshing: false, isExpiringSoon: false, isImpersonating: false });
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
    // Impersonation entry point: a tab opened via window.open() from the
    // tenant switcher carries ?impersonation_token=... in the URL. Detect
    // and consume it BEFORE any normal silent-refresh boot flow runs.
    const params = new URLSearchParams(window.location.search);
    const impersonationToken = params.get("impersonation_token");
    // The tenant switcher (and the MSP list / MSP detail impersonate buttons)
    // carry the target MSP/customer slug alongside the token so this tab can
    // land on the CORRECT tenant's URL. Without it we cannot own the redirect
    // and would fall back to the opener's inherited slug (the original bug).
    const targetSlug = params.get("target_slug");

    if (impersonationToken) {
      // This tab may have inherited the opener's sessionStorage (same-origin
      // window.open copies it). Clear any stale refresh-token keys so this
      // tab can never fall back to them.
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_EXPIRES_AT_KEY);

      fetch("/api/auth/impersonate-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: impersonationToken }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = (await res.json()) as { accessToken: string; user: AuthUser };
            // Set state directly — do NOT call applyTokens(), which schedules
            // a refresh-expiry warning and would start the periodic silent-
            // refresh interval. An impersonation session has no refresh
            // token and must expire naturally when its 30-min JWT expires.
            setState({
              user: data.user,
              accessToken: data.accessToken,
              isLoading: false,
              isRefreshing: false,
              isExpiringSoon: false,
              isImpersonating: true,
            });

            // Own the FULL redirect here. RootRedirect early-returns whenever
            // an impersonation_token is present (see App.tsx), so this is the
            // only code that decides where the impersonated tab lands. A hard
            // navigation would wipe the in-memory access token (impersonation
            // sessions have no refresh token), so we navigate client-side by
            // pushing the target URL and letting wouter re-render.
            if (targetSlug) {
              // CustomerUser lands on the customer dashboard; MSP-side roles land
              // on the dashboard. mspRole is the impersonated identity's role.
              const landing =
                data.user.mspRole === "CustomerUser" ? "customer-dashboard" : "dashboard";
              const base = import.meta.env.BASE_URL.replace(/\/$/, "");
              const target = `${base}/${targetSlug}/${landing}`;
              window.history.pushState({}, "", target);
              // wouter's browser location hook patches pushState to emit its
              // own event, so this push triggers a client-side route change
              // without a full reload.
            } else {
              // Defensive: post-fix every impersonation URL carries target_slug.
              // If it's missing we cannot safely pick a tenant, so surface it
              // and just strip the token from the URL.
              toast.error(
                "Impersonation started but the target tenant was missing — please navigate manually.",
              );
              reportClientEvent(
                data.accessToken,
                "ImpersonationMissingTargetSlug",
                "Impersonation exchange succeeded but target_slug was missing from the URL",
                "client.frontend",
                { mspRole: data.user.mspRole, isImpersonating: true },
              );
              const url = new URL(window.location.href);
              url.searchParams.delete("impersonation_token");
              url.searchParams.delete("target_slug");
              window.history.replaceState({}, "", url.toString());
            }
          } else {
            setState((s) => ({ ...s, isLoading: false }));
          }
        })
        .catch(() => {
          setState((s) => ({ ...s, isLoading: false }));
        });
      return;
    }

    const BOOT_TIMEOUT_MS = 5_000;
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), BOOT_TIMEOUT_MS),
    );

    // Keep a reference to the underlying refresh promise so we can attach a
    // late-success handler independently of the race.
    const refreshPromise = doRefresh();

    // Unblock the UI as soon as either the refresh or the timeout resolves.
    void Promise.race([refreshPromise, timeout]).then((token) => {
      if (!token) {
        // Timeout won (or refresh returned nothing) — unblock the UI so the
        // login form can render immediately.
        setState((s) => ({ ...s, isLoading: false }));
      } else {
        // Refresh resolved within the timeout window — start the interval.
        silentRefreshTimerRef.current = setInterval(() => {
          void doRefresh();
        }, SILENT_REFRESH_INTERVAL_MS);
      }
    });

    // If the timeout fires first but the refresh later resolves successfully,
    // still start the silent-refresh interval (the race discards this case).
    void refreshPromise.then((token) => {
      if (token && !silentRefreshTimerRef.current) {
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

  useEffect(() => {
    currentAccessToken = state.accessToken;
  }, [state.accessToken]);

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

        // Return the parsed user so callers can use mspSlug immediately
        // without waiting for async React state propagation.
        const user = parseJwt(data.accessToken);
        return { user: user ?? undefined };
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
    setState({ user: null, accessToken: null, isLoading: false, isRefreshing: false, isExpiringSoon: false, isImpersonating: false });
  }, [clearTimers]);

  const extendSession = useCallback(async () => {
    setState((s) => ({ ...s, isExpiringSoon: false, isRefreshing: true }));
    await doRefresh();
  }, [doRefresh]);

  const fetchWithAuth = useCallback(
    async (
      input: RequestInfo | URL,
      init?: RequestInit,
      opts?: { silent?: boolean },
    ): Promise<Response> => {
      let token = state.accessToken;

      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);

      let res = await fetch(input, { ...init, headers });

      if (res.status === 401 && !state.user?.impersonatedBy) {
        // Access token may have expired mid-request — try one silent refresh.
        // Skipped entirely during impersonation: doRefresh() would send the
        // browser's shared refreshToken cookie, which belongs to the admin
        // who opened this tab, not the impersonated session — that would
        // silently swap identity back to the admin. An impersonation
        // session on a 401 should just end; the caller sees the failed
        // response and the banner's "Exit Preview" button is always there.
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
      // Callers doing best-effort background work (opts.silent) handle
      // failure themselves and opt out of the global toast.
      if (!res.ok && res.status !== 401 && !opts?.silent) {
        let message = `Request failed (${res.status})`;
        try {
          const clone = res.clone();
          const data = (await clone.json()) as {
            error?: string | { code?: string; message?: string; details?: unknown; traceId?: string };
            message?: string;
          };
          if (typeof data.error === "string") message = data.error;
          else if (data.error && typeof data.error === "object" && typeof data.error.message === "string") {
            message = data.error.message;
          } else if (data.message) message = data.message;
        } catch {
          // body not JSON — keep generic message
        }
        toast.error(message);

        // Also beacon every failed request into the exception tracker so it
        // shows up in Simulator Studio / the log stream, not just as a toast
        // the user may have already dismissed.
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        reportClientEvent(token, "ApiRequestFailed", message, "client.frontend", {
          url: requestUrl,
          status: res.status,
        });
      }

      return res;
    },
    [state.accessToken, doRefresh],
  );

  const completeMfaLogin = useCallback(
    (accessToken: string, refreshToken?: string, refreshExpiresAt?: string) => {
      applyTokens(accessToken, refreshToken, refreshExpiresAt);
      // Start periodic silent access-token refresh
      if (silentRefreshTimerRef.current) clearInterval(silentRefreshTimerRef.current);
      silentRefreshTimerRef.current = setInterval(() => {
        void doRefresh();
      }, SILENT_REFRESH_INTERVAL_MS);
    },
    [applyTokens, doRefresh],
  );

  const value: AuthContextValue = {
    ...state,
    login,
    completeMfaLogin,
    logout,
    extendSession,
    fetchWithAuth,
    isImpersonating: state.isImpersonating,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
