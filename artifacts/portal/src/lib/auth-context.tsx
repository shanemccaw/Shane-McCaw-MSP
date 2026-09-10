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

/**
 * The legacy `msp_role` claim, as an OPAQUE string (#2459, part of #1696).
 *
 * This was a seven-member union of role literals, and the union is gone on
 * purpose. #1696's re-measure comment on the artifacts being built now is
 * explicit: *"Neither should ever import a role literal. They consume
 * capabilities, not roles."* A union of literals is exactly what makes
 * `mspRole === "CustomerUser"` compile, and this file had two such comparisons
 * (`:476`, `:801`) deciding where an impersonated identity landed — an
 * authorization-shaped rule the server could not see.
 *
 * Typing it `string` is the point, not a loss: there is no role name the portal
 * is entitled to recognise, so a comparison against one should look as arbitrary
 * as it is. Ask `can()` for a capability, or read `presentation` — both come off
 * `GET /api/auth/me/context`, which answers from the same
 * `*_feature_role_mapping` rows the server's own evaluator reads.
 *
 * The claim itself is still surfaced because it is real, and because #2460 (not
 * this step) is what retires `MSP_ROLES` and the claim with it.
 */
export type MspRole = string;

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

/**
 * Git #2991 (Feature #1648, Auth Core) — thrown by every auth-flow call below
 * that can fail with a structured error the caller needs to branch on (a
 * locked-account timestamp, a distinct 404 reason, an entitlement code) —
 * not just a message string. `data` is the real parsed response body, so a
 * caller can read e.g. `err.data?.lockedUntil` without a second fetch.
 */
export class AuthApiError extends Error {
  status: number;
  data: Record<string, unknown> | undefined;
  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.data = data;
  }
}

/** GET /auth/setup-context response shape (auth.ts:704-714). */
export interface SetupContext {
  clientName: string | null;
  firstName: string | null;
  role: MspRole | null;
  slug: string | null;
  products: { name: string; tagline: string | null; category: string | null }[];
}

/** Shared shape returned by setup-password and both MFA challenge endpoints. */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: AuthUser;
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
  /** POST /auth/forgot-password — always resolves; the endpoint itself is unconditionally 200 (auth.ts:718-780). */
  forgotPassword: (email: string) => Promise<void>;
  /** POST /auth/reset-password — throws AuthApiError on a dead/short-password link. */
  resetPassword: (token: string, password: string) => Promise<{ ok: true }>;
  /** GET /auth/setup-context — throws AuthApiError (404) for a dead link or missing account. */
  getSetupContext: (token: string) => Promise<SetupContext>;
  /** POST /auth/setup-password — signs the account in on success (Git #439's mfaSetupPending applies). */
  setupPassword: (token: string, password: string) => Promise<AuthSession>;
  /** POST /auth/mfa/totp/challenge — completes the pending login on success. */
  mfaTotpChallenge: (mfaToken: string, code: string) => Promise<AuthSession>;
  /** POST /auth/mfa/bypass — completes the pending login on success. */
  mfaBypass: (mfaToken: string, code: string) => Promise<AuthSession>;
  /** POST /portal/sign-in-help/ticket — the caller is by definition unauthenticated. */
  signInHelp: (
    email: string,
    issueKey: "mfa" | "locked" | "nocode" | "other",
  ) => Promise<{ reference: string; priority: string; routingNote: string; email: string }>;
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

  /**
   * Git #2459 (part of #1696) — the signed-in identity's real capability grants
   * and presentation strings, from `GET /api/auth/me/context`.
   *
   * Null until the first fetch resolves, and null again if it fails. Callers
   * should use `can()` rather than reading this directly; it is exposed so a
   * surface that needs to distinguish "still loading" from "denied" can.
   */
  sessionContext: SessionContext | null;

  /**
   * May this identity do `capability` in `system`?
   *
   * **This is a presentation hint, not access control.** #1696, verbatim:
   * *"hiding a nav item is not access control."* What it buys is that the hint
   * now reads the SAME `*_feature_role_mapping` rows the server's own evaluator
   * reads, so it cannot silently drift from the server the way a hardcoded
   * `role === "MSPAdmin"` comparison in a component could. The route is still
   * the gate, and every route keeps whatever middleware it has.
   *
   * Returns `true` while the context is unresolved, and `true` when the server
   * reports the model unreadable (`model.available === false`). Both are
   * deliberate: a hint that cannot be evaluated must ABSTAIN rather than hide.
   * Hiding a surface because a table could not be read would break the whole UI
   * on an infrastructure failure, to no security benefit — the server would
   * still refuse the request. Fail-closed belongs on the enforcement path
   * (`rbac-ladder.ts` answers 503 there); this is not that path.
   */
  can: (system: "msp" | "customer", capability: string) => boolean;

  /**
   * Display label for the signed-in identity, e.g. "MSP Admin".
   *
   * Server-supplied (#2459). This used to be a role→label table in `UserMenu`,
   * keyed by the seven role literals. Falls back to the coarse `role` claim
   * while the context is still loading, so the badge is never blank.
   */
  roleLabel: string;
}

/** `GET /api/auth/me/context` — see artifacts/api-server/src/routes/auth-session-context.ts. */
export interface SessionContext {
  user: { id: number; email: string; role: "admin" | "client"; mspRole: MspRole | null };
  presentation: { roleLabel: string; landingSurface: string };
  /** false = the RBAC model could not be read; every `can()` abstains to true. */
  model: { available: boolean };
  capabilities: { msp: string[]; customer: string[] };
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
): Promise<{ accessToken: string; user: AuthUser; landingSurface?: string } | null> {
  try {
    const res = await fetch("/api/auth/impersonate-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { accessToken: string; user: AuthUser; landingSurface?: string };
  } catch {
    return null;
  }
}

/**
 * Where an impersonated identity lands, per the SERVER (#2459, part of #1696).
 *
 * Both call sites used to run their own copy of
 * `mspRole === "Assessment" ? … : mspRole === "CustomerUser" ? … : …`. Two copies
 * of an identity rule in a component is the shape #1696 calls *"a rule that
 * exists nowhere the server can enforce it"*, and duplicating it twice in one
 * file is how such a rule ends up disagreeing with itself. The rule now lives in
 * `artifacts/api-server/src/lib/identity-presentation.ts` and arrives on the
 * exchange response.
 *
 * The fallback is `"dashboard"` — the same default the old chain fell through
 * to — so a server that predates the field lands exactly where it used to
 * rather than nowhere.
 */
function landingSurfaceOf(data: { landingSurface?: string }): string {
  return data.landingSurface ?? "dashboard";
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

/**
 * Git #1043 (Epic #660, Phase 1) — exchangePrintToken's sibling for a
 * live-rendered document (JOURNEY_LIVE_DOCUMENTS), whose print URL carries
 * `?docPrintToken=...` instead of `?printToken=...` (see
 * buildLiveDocumentPrintUrl in portal-url.ts) because it is minted against
 * documentPrintTokensTable, a different table keyed by docType rather than
 * documentId. Same shape as exchangePrintToken; kept separate for the same
 * reason exchangePrintToken is kept separate from exchangeImpersonationToken.
 */
async function exchangeDocumentPrintToken(
  token: string,
): Promise<{ accessToken: string; user: AuthUser } | null> {
  try {
    const res = await fetch("/api/auth/document-print-exchange", {
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
 * Git #636 (Epic: A. Core Assessment Product) — auto-login after the
 * marketing site's assessment flow sets the buyer's real password
 * (POST /public/flow/set-password). Unlike the print-exchange siblings above,
 * this trades for a REAL, ordinary session — /auth/signup-exchange responds
 * with the same shape /auth/login itself does (accessToken/refreshToken/
 * refreshExpiresAt/user), not the leaner accessToken-only shape print-exchange
 * returns, since the boot effect applies it via applyTokens() rather than a
 * raw setState.
 */
async function exchangeSignupToken(
  token: string,
): Promise<{ accessToken: string; refreshToken?: string; refreshExpiresAt?: string; user: AuthUser } | null> {
  try {
    const res = await fetch("/api/auth/signup-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      accessToken: string;
      refreshToken?: string;
      refreshExpiresAt?: string;
      user: AuthUser;
    };
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
            // the Portal v2 Overview; MSP-side roles land on the dashboard —
            // decided server-side for the impersonated identity (#2459).
            const landing = landingSurfaceOf(data);
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

    // Print entry point for a live-rendered document (Git #1043, Epic #660):
    // same shape as the printToken branch above, but for a document keyed by
    // docType rather than a numeric id (see buildLiveDocumentPrintUrl in
    // portal-url.ts) — a distinct query param so this tab's URL is never
    // ambiguous about which token table minted it.
    const docPrintToken = params.get("docPrintToken");
    if (docPrintToken) {
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_EXPIRES_AT_KEY);

      exchangeDocumentPrintToken(docPrintToken).then((data) => {
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
          url.searchParams.delete("docPrintToken");
          window.history.replaceState({}, "", url.toString());
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      });
      return;
    }

    // Auto-login entry point (Git #636): the marketing site's assessment
    // flow lands the buyer's own new tab here with ?signupToken=... right
    // after they set their real password. Unlike the print-token branches
    // above, this is the buyer's real, ongoing session — applyTokens() (not
    // a raw setState) so the refresh timer / "are you still there?" warning
    // are set up exactly as they would be for a normal password login.
    //
    // Git #1315 (Epic #1309, Phase 6) — a `product` hint may ride alongside
    // signupToken (set by the purchase portal-handoff endpoint, #1313,
    // resolved from the session's own services.category). Retainer owns a
    // real destination beyond the generic CustomerUser landing FlatLoggedInRedirect
    // otherwise picks: "My Architect" (#1285), so a Retainer purchase lands
    // there directly rather than on the Overview and needing a second click.
    // Absent or any other category, this falls through to today's unchanged
    // default landing — Phases 5/7 can add their own branch here the same way
    // when they need a destination beyond the default.
    const signupToken = params.get("signupToken");
    if (signupToken) {
      const product = params.get("product");
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_EXPIRES_AT_KEY);

      exchangeSignupToken(signupToken).then((data) => {
        if (data) {
          applyTokens(data.accessToken, data.refreshToken, data.refreshExpiresAt);
          // Single-use and already consumed — strip it (and the routing
          // hint) so neither is ever visible/bookmarkable/retried.
          const url = new URL(window.location.href);
          url.searchParams.delete("signupToken");
          url.searchParams.delete("product");
          window.history.replaceState({}, "", url.toString());

          if (product === "retainer" && data.user.mspSlug) {
            // SlugProvider (mounted once this route renders) persists the
            // slug to sessionStorage itself — no need to duplicate that here.
            const base = import.meta.env.BASE_URL.replace(/\/$/, "");
            window.history.pushState({}, "", `${base}/${data.user.mspSlug}/portal-v2/retainer`);
            // wouter's browser location hook patches pushState to emit its
            // own event (same mechanism the impersonation branch above
            // relies on), so this lands the tab without a full reload.
          }
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
        accountLocked?: boolean;
        lockedUntil?: string;
      };

      // AuthApiError (not a plain Error) so the login screen can branch on
      // res.status/data — a 423 lockout carries a real lockedUntil timestamp
      // the caller needs, and a 401 covers two distinct backend cases (bad
      // credentials vs. no password set) behind one deliberately generic
      // message (auth.ts:338, 343 — contract pack §1).
      if (!res.ok) throw new AuthApiError(data.error ?? "Login failed", res.status, data);

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
        const landing = landingSurfaceOf(data);
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

  // ── Capability context (Git #2459, part of #1696) ─────────────────────────
  //
  // Fetched once per real session identity, not per render: the dependency is
  // the user id, so a silent access-token refresh (every ~13 min) does NOT
  // re-fetch, while an impersonation swap or a return-to-admin — both of which
  // change who the session is — does. Grants that change mid-session are picked
  // up on the next sign-in, which is the same freshness the JWT claims already
  // have; a hint surface polling the model would be cost with no benefit.
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const sessionUserId = state.user?.id ?? null;

  useEffect(() => {
    if (!state.accessToken || sessionUserId === null) {
      setSessionContext(null);
      return;
    }
    let cancelled = false;
    // silent: a failure here must not toast. The shell stays fully usable
    // without it — every `can()` abstains to true — so surfacing it as an error
    // would be noise about something the user cannot act on.
    fetchWithAuth("/api/auth/me/context", undefined, { silent: true })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SessionContext | null) => {
        if (!cancelled) setSessionContext(data);
      })
      .catch(() => {
        if (!cancelled) setSessionContext(null);
      });
    return () => {
      cancelled = true;
    };
    // fetchWithAuth is intentionally omitted: it is re-created on every access-
    // token change, and depending on it would re-run this on each silent
    // refresh. The token it closes over is read at call time either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId, state.accessToken === null]);

  const can = useCallback(
    (system: "msp" | "customer", capability: string): boolean => {
      // Unresolved or unreadable → abstain. See the doc on AuthContextValue.can.
      if (!sessionContext || !sessionContext.model.available) return true;
      return sessionContext.capabilities[system].includes(capability);
    },
    [sessionContext],
  );

  const roleLabel =
    sessionContext?.presentation.roleLabel ?? (state.user?.role === "admin" ? "Admin" : "Customer");

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

  // ── Auth Core (#2991, Feature #1648) — the remaining unauthenticated flows ──

  const forgotPassword = useCallback(async (email: string): Promise<void> => {
    // auth.ts:718-780 responds 200 { ok: true } unconditionally, before any
    // lookup runs — there is nothing for a caller to branch on, so this never
    // throws. A network failure here is swallowed the same way the backend
    // itself swallows a mail-send failure: "received" only ever means the
    // request was accepted.
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // ignore — see above
    }
  }, []);

  const resetPassword = useCallback(async (token: string, password: string): Promise<{ ok: true }> => {
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new AuthApiError(data.error ?? "Reset failed", res.status, data);
    return { ok: true };
  }, []);

  const getSetupContext = useCallback(async (token: string): Promise<SetupContext> => {
    const res = await fetch(`/api/auth/setup-context?token=${encodeURIComponent(token)}`);
    const data = (await res.json()) as Partial<SetupContext> & { error?: string };
    if (!res.ok) throw new AuthApiError(data.error ?? "This setup link is invalid or has expired.", res.status, data);
    return data as SetupContext;
  }, []);

  const setupPassword = useCallback(
    async (token: string, password: string): Promise<AuthSession> => {
      const res = await fetch("/api/auth/setup-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as Partial<AuthSession> & { error?: string };
      if (!res.ok) throw new AuthApiError(data.error ?? "Setup failed", res.status, data);

      const session = data as AuthSession;
      // This is the one setup-flow route that signs the account in on success
      // (contract pack §1) — apply the session and start the same silent-
      // refresh loop login()/completeMfaLogin() start.
      applyTokens(session.accessToken, session.refreshToken, session.refreshExpiresAt);
      if (silentRefreshTimerRef.current) clearInterval(silentRefreshTimerRef.current);
      silentRefreshTimerRef.current = setInterval(() => {
        void doRefresh();
      }, SILENT_REFRESH_INTERVAL_MS);
      return session;
    },
    [applyTokens, doRefresh],
  );

  const mfaTotpChallenge = useCallback(
    async (mfaToken: string, code: string): Promise<AuthSession> => {
      const res = await fetch("/api/auth/mfa/totp/challenge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken, code }),
      });
      const data = (await res.json()) as Partial<AuthSession> & { error?: string };
      if (!res.ok) throw new AuthApiError(data.error ?? "Verification failed", res.status, data);
      const session = data as AuthSession;
      completeMfaLogin(session.accessToken, session.refreshToken, session.refreshExpiresAt);
      return session;
    },
    [completeMfaLogin],
  );

  const mfaBypass = useCallback(
    async (mfaToken: string, code: string): Promise<AuthSession> => {
      const res = await fetch("/api/auth/mfa/bypass", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken, code }),
      });
      const data = (await res.json()) as Partial<AuthSession> & { error?: string };
      if (!res.ok) throw new AuthApiError(data.error ?? "Verification failed", res.status, data);
      const session = data as AuthSession;
      completeMfaLogin(session.accessToken, session.refreshToken, session.refreshExpiresAt);
      return session;
    },
    [completeMfaLogin],
  );

  const signInHelp = useCallback(
    async (
      email: string,
      issueKey: "mfa" | "locked" | "nocode" | "other",
    ): Promise<{ reference: string; priority: string; routingNote: string; email: string }> => {
      const res = await fetch("/api/portal/sign-in-help/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, issueKey }),
      });
      const data = (await res.json()) as {
        reference?: string;
        priority?: string;
        routingNote?: string;
        email?: string;
        error?: string;
      };
      if (!res.ok) throw new AuthApiError(data.error ?? "Could not raise a ticket", res.status, data);
      return data as { reference: string; priority: string; routingNote: string; email: string };
    },
    [],
  );

  const value: AuthContextValue = {
    ...state,
    login,
    completeMfaLogin,
    forgotPassword,
    resetPassword,
    getSetupContext,
    setupPassword,
    mfaTotpChallenge,
    mfaBypass,
    signInHelp,
    logout,
    extendSession,
    fetchWithAuth,
    isImpersonating: state.isImpersonating,
    switchToTenant,
    returnToAdmin,
    sessionContext,
    can,
    roleLabel,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
