/**
 * Thin fetch wrappers for the pre-login / self-service auth routes this
 * screen wires (auth.ts, mfa.ts). Deliberately plain `fetch`, not the
 * generated api-client — the same convention `AdminSecurity.tsx` and
 * `contexts/AuthContext.tsx` already use for this exact route family, since
 * none of these calls carry a bearer token yet (login, the MFA challenge) or
 * need one only via `fetchWithAuth` (self-service enrollment).
 *
 * Every call surfaces the server's real status code and body via
 * `AuthApiError` rather than collapsing everything to a message string, so a
 * caller can render the distinct 400 / 401 / 423 states screen 38 requires
 * instead of one generic error.
 */

export class AuthApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body?.error === "string" ? (body.error as string) : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function postJson<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AuthApiError(res.status, data);
  return data as T;
}

export interface SessionUser {
  id: number;
  email: string;
  role: string;
  mfaSetupPending?: boolean;
  [key: string]: unknown;
}

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: SessionUser;
}

export interface MfaRequiredResult {
  mfaRequired: true;
  mfaToken: string;
  methods: string[];
}

export type LoginResult = SessionResult | MfaRequiredResult;

export function isMfaRequired(result: LoginResult): result is MfaRequiredResult {
  return "mfaRequired" in result && result.mfaRequired === true;
}

// ─── POST /api/auth/login ───────────────────────────────────────────────────
export function login(email: string, password: string): Promise<LoginResult> {
  return postJson<LoginResult>("/api/auth/login", { email, password });
}

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────
// Always resolves { ok: true } — the route answers before it even looks the
// account up (see auth.ts). There is nothing to distinguish client-side.
export function forgotPassword(email: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>("/api/auth/forgot-password", { email });
}

// ─── POST /api/auth/reset-password ──────────────────────────────────────────
export function resetPassword(token: string, password: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>("/api/auth/reset-password", { token, password });
}

// ─── POST /api/auth/mfa/verify (totp | sms) ─────────────────────────────────
export function mfaVerify(mfaToken: string, method: "totp" | "sms", code: string): Promise<SessionResult> {
  return postJson<SessionResult>("/api/auth/mfa/verify", { mfaToken, method, code });
}

// ─── POST /api/auth/mfa/bypass ───────────────────────────────────────────────
export function mfaBypass(mfaToken: string, code: string): Promise<SessionResult> {
  return postJson<SessionResult>("/api/auth/mfa/bypass", { mfaToken, code });
}

// ─── POST /api/auth/mfa/sms/send ─────────────────────────────────────────────
export function mfaSmsSend(mfaToken: string): Promise<{ ok: true; phoneLast4: string }> {
  return postJson<{ ok: true; phoneLast4: string }>("/api/auth/mfa/sms/send", { mfaToken });
}

// ─── Passkey challenge (unauthenticated — gated by mfaToken, not a bearer) ──
export function passkeyAuthenticationOptions(mfaToken: string): Promise<unknown> {
  return postJson<unknown>("/api/auth/mfa/passkey/authentication-options", { mfaToken });
}

export function passkeyVerifyAuthentication(
  mfaToken: string,
  authenticationResponse: Record<string, unknown>,
): Promise<SessionResult> {
  return postJson<SessionResult>("/api/auth/mfa/passkey/verify-authentication", {
    mfaToken,
    ...authenticationResponse,
  });
}
