import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLayout, FieldLabel, TextField, PrimaryButton, InlineMessage } from "./AuthLayout";
import { login, isMfaRequired, AuthApiError, type MfaRequiredResult } from "./authApi";
import { text } from "@/console/tokens";

/** The mfa challenge is handed to /mfa via sessionStorage (not route state —
 * wouter has none, and a reload mid-challenge should not silently drop the
 * user back to a blank screen). Screen 38: "MFA session token expires 10
 * minutes after the password step" — the token itself carries that expiry,
 * this is just how it survives the navigation to /mfa. */
const MFA_CHALLENGE_KEY = "smc.mfaChallenge";
const RETURN_TO_KEY = "smcReturnTo";

export function stashMfaChallenge(challenge: MfaRequiredResult) {
  sessionStorage.setItem(MFA_CHALLENGE_KEY, JSON.stringify({ mfaToken: challenge.mfaToken, methods: challenge.methods }));
}

export function readMfaChallenge(): { mfaToken: string; methods: string[] } | null {
  const raw = sessionStorage.getItem(MFA_CHALLENGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { mfaToken: string; methods: string[] };
  } catch {
    return null;
  }
}

export function clearMfaChallenge() {
  sessionStorage.removeItem(MFA_CHALLENGE_KEY);
}

function consumeReturnTo(): string {
  const rel = sessionStorage.getItem(RETURN_TO_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  return rel && rel.startsWith("/") && !rel.startsWith("/login") ? rel : "/tenants";
}

export default function SignInPage() {
  const { setSession } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ tone: "critical" | "warning"; code: string; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError({ tone: "critical", code: "400 · missing fields", text: "email and password are required" });
      return;
    }

    setLoading(true);
    try {
      const result = await login(email.trim(), password);

      if (isMfaRequired(result)) {
        stashMfaChallenge(result);
        setLocation("/mfa");
        return;
      }

      setSession(result.accessToken);
      if (result.user.mfaSetupPending) {
        setLocation("/account/mfa");
      } else {
        setLocation(consumeReturnTo());
      }
    } catch (err) {
      if (err instanceof AuthApiError) {
        if (err.status === 423) {
          const lockedUntil = typeof err.body.lockedUntil === "string" ? new Date(err.body.lockedUntil) : null;
          setError({
            tone: "critical",
            code: "423 · accountLocked",
            text: lockedUntil
              ? `${err.message} Locked until ${lockedUntil.toLocaleTimeString()}.`
              : err.message,
          });
        } else if (err.status === 401 && err.message.startsWith("No password set")) {
          // The distinguishable 401 (Git #3814) — a real account with no
          // password yet, not a wrong-credentials guess. Amber, not red, and
          // the message itself already points at the recovery path.
          setError({ tone: "warning", code: "401 · no password set", text: err.message });
        } else if (err.status === 401) {
          setError({ tone: "critical", code: "401 · Invalid email or password", text: err.message });
        } else {
          setError({ tone: "critical", code: `${err.status}`, text: err.message });
        }
      } else {
        setError({ tone: "critical", code: "Network error", text: "Could not reach the server. Try again." });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout caption="Portal sign-in">
      <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: text.strong }}>
        Sign in to the console
      </span>

      <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <FieldLabel>Work email</FieldLabel>
          <TextField
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@tenant.com"
            autoFocus
            autoComplete="username"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <FieldLabel>Password</FieldLabel>
          <TextField
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </label>

        {error && <InlineMessage tone={error.tone} code={error.code} text={error.text} />}

        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </PrimaryButton>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setLocation("/forgot-password")}
            style={{ background: "none", border: "none", padding: 0, color: "#60a5fa", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            Forgot your password?
          </button>
          <span style={{ fontSize: 10.5, color: text.faint }}>No sign-up link — accounts come from a purchase</span>
        </div>
      </form>
    </AuthLayout>
  );
}
