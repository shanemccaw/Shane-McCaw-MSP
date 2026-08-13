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
  | "Free"
  | "Assessment";

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
  /**
   * Git #439 — set when this session was issued under MFA enforcement with
   * zero MFA methods enrolled yet. requireAuth refuses every route except the
   * MFA enrollment endpoints until enrollment completes; the app shell
   * redirects to /setup-mfa instead of rendering normal protected routes.
   */
  mfaSetupPending?: boolean;
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
  /**
   * Git #796 — swap the live session to an impersonated tenant in place (no
   * new tab, no reload). Before the FIRST call, the real admin's session is
   * stashed in memory so returnToAdmin() can restore it later. `targetSlug`
   * is optional: pass it to also land on that tenant's landing route (same
   * behavior as the URL-token boot flow); omit it to swap identity only and
   * let the current route re-render as the new tenant.
   */
  switchToTenant: (token: string, targetSlug?: string) => Promise<void>;
  /**
   * Git #796 — restore the real admin's stashed session in place. No-op if
   * there is nothing stashed (i.e. switchToTenant was never called).
   */
  returnToAdmin: () => Promise<void>;
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

/**
 * Git #796 — the actual token exchange, shared by the URL-token boot flow
 * (mount-only useEffect below) and the callable switchToTenant(). Deliberately
 * does NOT touch React state or navigate; callers own that so each keeps its
 * own branching (the boot flow's missing-target-slug toast vs. switchToTenant's
 * simpler in-place swap).
 */
async function exchangeImpersonationToken(
  token: string,
): Promise<{ accessToken: string; user: AuthUser } | null> {
  try {
    const res = await fetch("/api/auth/impersonate-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { accessToken: string; user: AuthUser };
  } catch {
    return null;
  }
}

/**
 * Git #415 — the print pipeline's own token exchange. Headless Chromium has
 * no interactive session of its own; it navigates the live Document Viewer
 * route with `?printToken=...` in the URL, and the boot effect below trades
 * it here for a real, short-lived JWT for the SAME user the token was minted
 * for (never a different target — this is not impersonation). Mirrors
 * exchangeImpersonationToken's shape exactly; kept separate because the two
 * exchange endpoints, and what a caller does with the result, are unrelated.
 */
async function exchangePrintToken(
  token: string,
): Promise<{ accessToken: string; user: AuthUser } | null> {
  try {
    const res = await fetch("/api/auth/print-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { accessToken: string; user: AuthUser };
  } catch {
    return null;
  }
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
  /**
   * Git #796 — the real admin's session, stashed in memory on the FIRST
   * switchToTenant() call so returnToAdmin() can restore it in place. Deliberately
   * NOT sessionStorage: impersonation sessions must not carry a refresh token
   * (see doRefresh's impersonation skip below), so the stash has to live
   * somewhere sessionStorage-clearing during impersonation can't touch.
   */
  const adminSessionStashRef = useRef<{
    accessToken: string;
    refreshToken: string | null;
    refreshExpiresAt: string | null;
  } | null>(null);

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

      exchangeImpersonationToken(impersonationToken).then((data) => {
        if (data) {
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
            // Assessment lands on the assessment shell; CustomerUser lands on
            // M365 Health; MSP-side roles land on the dashboard. mspRole is
            // the impersonated identity's role.
            const landing =
              data.user.mspRole === "Assessment"
                ? "copilot-readiness"
                : data.user.mspRole === "CustomerUser"
                  ? "m365-health"
                  : "dashboard";
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
      });
      return;
    }

    // Print entry point (Git #415): headless Chromium's own tab, carrying
    // ?printToken=... instead of a password. Unlike impersonation, this is
    // the real user's own identity and the tab is already on the exact
    // document route it needs to print — no isImpersonating flag, no
    // target-slug landing redirect, just enough of a session for the page's
    // own API calls (fetchWithAuth) to succeed.
    const printToken = params.get("printToken");
    if (printToken) {
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_EXPIRES_AT_KEY);

      exchangePrintToken(printToken).then((data) => {
        if (data) {
          setState({
            user: data.user,
            accessToken: data.accessToken,
            isLoading: false,
            isRefreshing: false,
            isExpiringSoon: false,
            isImpersonating: false,
          });
          // Single-use and already consumed — strip it so it is never
          // visible/bookmarkable/retried.
          const url = new URL(window.location.href);
          url.searchParams.delete("printToken");
          window.history.replaceState({}, "", url.toString());
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
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

      // An account under MFA enforcement with nothing enrolled yet (Git #439)
      // now comes back here too — a real accessToken, just carrying
      // mfaSetupPending: true on its `user` claims. The app shell's route
      // gate (useMfaGate in App.tsx) reads that and redirects to /setup-mfa;
      // there is no separate dead-end response shape for this case anymore.
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

  // ── Git #796: in-place tenant switching ──────────────────────────────────

  const switchToTenant = useCallback(
    async (token: string, targetSlug?: string): Promise<void> => {
      // Stash the real admin's session on the FIRST switch only. A later
      // tenant-to-tenant switch (calling this again without returning to
      // admin first) must not clobber the stash with impersonated tokens.
      if (!adminSessionStashRef.current && state.accessToken) {
        adminSessionStashRef.current = {
          accessToken: state.accessToken,
          refreshToken: sessionStorage.getItem(REFRESH_TOKEN_KEY),
          refreshExpiresAt: sessionStorage.getItem(REFRESH_EXPIRES_AT_KEY),
        };
      }

      // Same invariant as the URL-token boot flow: an impersonation session
      // has no refresh token and must expire naturally at its own 30-min JWT
      // lifetime, so stop the admin's silent-refresh loop before swapping.
      clearTimers();
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_EXPIRES_AT_KEY);

      const data = await exchangeImpersonationToken(token);
      if (!data) {
        setState((s) => ({ ...s, isLoading: false }));
        reportClientEvent(
          state.accessToken,
          "TenantSwitchFailed",
          "switchToTenant: impersonate-exchange call failed",
          "auth.impersonation",
          { targetSlug: targetSlug ?? null },
        );
        return;
      }

      // Set state directly — do NOT call applyTokens(), for the same reason
      // as the boot flow: no refresh-expiry warning, no silent-refresh interval.
      setState({
        user: data.user,
        accessToken: data.accessToken,
        isLoading: false,
        isRefreshing: false,
        isExpiringSoon: false,
        isImpersonating: true,
      });

      if (targetSlug) {
        const landing =
          data.user.mspRole === "Assessment"
            ? "copilot-readiness"
            : data.user.mspRole === "CustomerUser"
              ? "m365-health"
              : "dashboard";
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        window.history.pushState({}, "", `${base}/${targetSlug}/${landing}`);
      }
      // When targetSlug is omitted, the caller (e.g. the Phase 2 tenant
      // switcher floaty) wants an identity swap only — the current route
      // re-renders as the new tenant rather than navigating away.

      reportClientEvent(
        data.accessToken,
        "TenantSwitchApplied",
        `Switched in place to mspRole=${data.user.mspRole ?? "unknown"}`,
        "auth.impersonation",
        { mspRole: data.user.mspRole, targetSlug: targetSlug ?? null },
      );
    },
    [state.accessToken, clearTimers],
  );

  const returnToAdmin = useCallback(async (): Promise<void> => {
    const stash = adminSessionStashRef.current;
    if (!stash) return;
    adminSessionStashRef.current = null;

    applyTokens(stash.accessToken, stash.refreshToken ?? undefined, stash.refreshExpiresAt ?? undefined);

    // applyTokens() only schedules the refresh-expiry warning — it doesn't
    // restart the periodic silent-refresh interval (login/completeMfaLogin
    // do that explicitly for the same reason), so resume it here.
    if (silentRefreshTimerRef.current) clearInterval(silentRefreshTimerRef.current);
    silentRefreshTimerRef.current = setInterval(() => {
      void doRefresh();
    }, SILENT_REFRESH_INTERVAL_MS);

    reportClientEvent(
      stash.accessToken,
      "TenantSwitchReturnToAdmin",
      "Returned to admin session in place",
      "auth.impersonation",
    );
  }, [applyTokens, doRefresh]);

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
    switchToTenant,
    returnToAdmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
